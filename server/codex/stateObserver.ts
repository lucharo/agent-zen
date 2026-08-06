import { Database } from 'bun:sqlite'
import { open, stat } from 'node:fs/promises'
import type { AgentSession, Project } from '../../src/domain/types'
import { normaliseGitHubRepository } from '../projects'
import { parseRolloutLines, stageHintFromMessage, type RolloutSnapshot } from './rollout'

interface ThreadRow {
  readonly id: string
  readonly rollout_path: string
  readonly created_at: number
  readonly updated_at: number
  readonly cwd: string
  readonly title: string
  readonly preview: string
  readonly name: string | null
  readonly model_provider: string
  readonly model: string | null
  readonly reasoning_effort: string | null
  readonly cli_version: string
  readonly git_branch: string | null
  readonly git_origin_url: string | null
  readonly created_at_ms: number | null
  readonly updated_at_ms: number | null
  readonly parent_thread_id: string | null
}

interface CachedRollout {
  readonly size: number
  readonly modifiedAt: number
  readonly snapshot: RolloutSnapshot
  readonly lifecycleLine: string | null
  readonly planLine: string | null
  readonly stageLine: string | null
}

export interface CodexStateObserverOptions {
  readonly dbPath: string
  readonly getProjects: () => readonly Project[] | Promise<readonly Project[]>
  readonly maxThreads?: number
  readonly maxRolloutBytes?: number
}

/** Read-only cross-process observer for Codex threads and rollout tails. */
export class CodexStateObserver {
  private readonly cache = new Map<string, CachedRollout>()

  constructor(private readonly options: CodexStateObserverOptions) {}

  async snapshot(): Promise<AgentSession[]> {
    const [rows, projects] = await Promise.all([
      Promise.resolve(this.readRows()),
      this.options.getProjects(),
    ])
    return Promise.all(rows.map((row) => this.toSession(row, projects)))
  }

  private readRows(): ThreadRow[] {
    const database = new Database(this.options.dbPath, { readonly: true })
    try {
      const query = database.query<ThreadRow, [number]>(`
        SELECT
          t.id, t.rollout_path, t.created_at, t.updated_at, t.cwd, t.title,
          t.preview, t.name, t.model_provider, t.model, t.reasoning_effort,
          t.cli_version, t.git_branch, t.git_origin_url, t.created_at_ms,
          t.updated_at_ms, e.parent_thread_id
        FROM threads t
        LEFT JOIN thread_spawn_edges e ON e.child_thread_id = t.id
        WHERE t.archived = 0
          AND NOT (
            t.source = 'exec'
            AND lower(trim(t.title)) LIKE 'you are a code reviewer. review the code changes shown below.%'
          )
        ORDER BY COALESCE(t.updated_at_ms, t.updated_at * 1000) DESC
        LIMIT ?
      `)
      return query.all(this.options.maxThreads ?? 120)
    } finally {
      database.close()
    }
  }

  private async toSession(
    row: ThreadRow,
    projects: readonly Project[],
  ): Promise<AgentSession> {
    const rollout = await this.rollout(row.rollout_path)
    const createdMs = row.created_at_ms ?? row.created_at * 1000
    const updatedMs = row.updated_at_ms ?? row.updated_at * 1000
    const repository = normaliseGitHubRepository(row.git_origin_url)
    const project = resolveProject(projects, row.cwd, repository)
    const active = rollout.activity === 'working'
    const review = rollout.stageHint === 'reviewing'
      ? { visualChecked: false, prReady: false, openNotes: 0, pullRequest: null }
      : null
    const wrapup = rollout.stageHint === 'wrapping-up'
      ? { checksPassed: 0, checksTotal: 1 }
      : null

    return {
      id: row.id,
      threadId: row.id,
      turnId: rollout.turnId,
      title: sessionTitle(row.name, row.title, row.preview),
      agent: 'codex',
      source: 'external',
      model: row.model ?? row.model_provider,
      reasoningEffort: row.reasoning_effort,
      cliVersion: row.cli_version || null,
      createdAt: new Date(createdMs).toISOString(),
      turnStartedAt: rollout.turnStartedAt,
      activity: active ? 'working' : 'ended',
      parentSessionId: row.parent_thread_id,
      cwd: row.cwd,
      repository,
      branch: row.git_branch,
      worktree: row.cwd,
      projectId: project?.id ?? null,
      plan: rollout.plan,
      planHistory: rollout.planHistory,
      review,
      wrapup,
      endedAt: active ? null : rollout.endedAt ?? new Date(updatedMs).toISOString(),
    }
  }

  private async rollout(rolloutPath: string): Promise<RolloutSnapshot> {
    const metadata = await stat(rolloutPath).catch(() => null)
    if (!metadata) return parseRolloutLines([])
    const cached = this.cache.get(rolloutPath)
    if (cached && cached.size === metadata.size && cached.modifiedAt === metadata.mtimeMs) {
      return cached.snapshot
    }

    const lines = await readTail(rolloutPath, this.options.maxRolloutBytes ?? 1024 * 1024)
    const tailLifecycle = lastLifecycleLine(lines)
    const lifecycleLine =
      tailLifecycle ?? cached?.lifecycleLine ?? (await findLastLifecycleLine(rolloutPath, metadata.size))
    const tailPlan = lastPlanLine(lines)
    const sameTurn = cached?.lifecycleLine === lifecycleLine
    let planLine = tailPlan ?? (sameTurn ? cached?.planLine ?? null : null)
    const tailStage = lastStageLine(lines)
    let stageLine = tailStage ?? (sameTurn ? cached?.stageLine ?? null : null)
    if (!planLine && lifecycleLine && lifecycleType(lifecycleLine) === 'task_started') {
      planLine = await findLastPlanLine(rolloutPath, metadata.size)
    }
    if (!stageLine && lifecycleLine && lifecycleType(lifecycleLine) === 'task_started') {
      stageLine = await findLastStageLine(rolloutPath, metadata.size)
    }
    if (planLine && !planBelongsToLifecycle(planLine, lifecycleLine)) planLine = null
    if (stageLine && !lineBelongsToLifecycle(stageLine, lifecycleLine)) stageLine = null

    const anchors = [
      lifecycleLine && lifecycleLine !== tailLifecycle ? lifecycleLine : null,
      planLine && planLine !== tailPlan ? planLine : null,
      stageLine && stageLine !== tailStage ? stageLine : null,
    ].filter((line): line is string => Boolean(line))
    anchors.sort((left, right) => lineTimestamp(left).localeCompare(lineTimestamp(right)))
    const snapshot = parseRolloutLines([...anchors, ...lines])
    this.cache.set(rolloutPath, {
      size: metadata.size,
      modifiedAt: metadata.mtimeMs,
      snapshot,
      lifecycleLine,
      planLine,
      stageLine,
    })
    return snapshot
  }
}

function lastPlanLine(lines: readonly string[]): string | null {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]
    if (line && planLineType(line)) return line
  }
  return null
}

function lastLifecycleLine(lines: readonly string[]): string | null {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]
    if (line && lifecycleType(line)) return line
  }
  return null
}

function lastStageLine(lines: readonly string[]): string | null {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]
    if (line && stageLineType(line)) return line
  }
  return null
}

async function findLastLifecycleLine(filePath: string, size: number): Promise<string | null> {
  const handle = await open(filePath, 'r')
  const chunkSize = 512 * 1024
  let position = size
  let carry = ''
  try {
    while (position > 0) {
      const start = Math.max(0, position - chunkSize)
      const length = position - start
      const bytes = Buffer.alloc(length)
      await handle.read(bytes, 0, length, start)
      const combined = bytes.toString('utf8') + carry
      const lines = combined.split('\n')
      carry = lines.shift() ?? ''
      const found = lastLifecycleLine(lines)
      if (found) return found
      position = start
    }
    return carry && lifecycleType(carry) ? carry : null
  } finally {
    await handle.close()
  }
}

async function findLastPlanLine(filePath: string, size: number): Promise<string | null> {
  const handle = await open(filePath, 'r')
  const chunkSize = 512 * 1024
  let position = size
  let carry = ''
  try {
    while (position > 0) {
      const start = Math.max(0, position - chunkSize)
      const length = position - start
      const bytes = Buffer.alloc(length)
      await handle.read(bytes, 0, length, start)
      const combined = bytes.toString('utf8') + carry
      const lines = combined.split('\n')
      carry = lines.shift() ?? ''
      const found = lastPlanLine(lines)
      if (found) return found
      position = start
    }
    return carry && planLineType(carry) ? carry : null
  } finally {
    await handle.close()
  }
}

async function findLastStageLine(filePath: string, size: number): Promise<string | null> {
  const handle = await open(filePath, 'r')
  const chunkSize = 512 * 1024
  let position = size
  let carry = ''
  try {
    while (position > 0) {
      const start = Math.max(0, position - chunkSize)
      const length = position - start
      const bytes = Buffer.alloc(length)
      await handle.read(bytes, 0, length, start)
      const combined = bytes.toString('utf8') + carry
      const lines = combined.split('\n')
      carry = lines.shift() ?? ''
      const found = lastStageLine(lines)
      if (found) return found
      position = start
    }
    return carry && stageLineType(carry) ? carry : null
  } finally {
    await handle.close()
  }
}

function lifecycleType(line: string): 'task_started' | 'task_complete' | 'turn_aborted' | null {
  if (!line.includes('task_started') && !line.includes('task_complete') && !line.includes('turn_aborted')) {
    return null
  }
  try {
    const record = JSON.parse(line) as { type?: string; payload?: { type?: string } }
    if (record.type !== 'event_msg') return null
    const type = record.payload?.type
    return type === 'task_started' || type === 'task_complete' || type === 'turn_aborted'
      ? type
      : null
  } catch {
    return null
  }
}

function planLineType(line: string): boolean {
  if (!line.includes('turn/plan/updated') && !line.includes('plan_update') && !line.includes('tools.update_plan')) {
    return false
  }
  return parseRolloutLines([line]).plan !== null
}

function stageLineType(line: string): boolean {
  if (!line.includes('user_message')) return false
  try {
    const record = JSON.parse(line) as { type?: string; payload?: { type?: string; message?: unknown } }
    return record.type === 'event_msg' &&
      record.payload?.type === 'user_message' &&
      stageHintFromMessage(typeof record.payload.message === 'string' ? record.payload.message : null) !== null
  } catch {
    return false
  }
}

function planBelongsToLifecycle(planLine: string, lifecycleLine: string | null): boolean {
  return lineBelongsToLifecycle(planLine, lifecycleLine)
}

function lineBelongsToLifecycle(line: string, lifecycleLine: string | null): boolean {
  if (!lifecycleLine || lifecycleType(lifecycleLine) !== 'task_started') return true
  return lineTimestamp(line) >= lineTimestamp(lifecycleLine)
}

function lineTimestamp(line: string): string {
  try {
    const record = JSON.parse(line) as { timestamp?: string }
    return typeof record.timestamp === 'string' ? record.timestamp : new Date(0).toISOString()
  } catch {
    return new Date(0).toISOString()
  }
}

async function readTail(filePath: string, maxBytes: number): Promise<string[]> {
  const metadata = await stat(filePath)
  const length = Math.min(metadata.size, maxBytes)
  const start = Math.max(0, metadata.size - length)
  const handle = await open(filePath, 'r')
  try {
    const bytes = Buffer.alloc(length)
    await handle.read(bytes, 0, length, start)
    let text = bytes.toString('utf8')
    if (start > 0) {
      const firstNewline = text.indexOf('\n')
      text = firstNewline === -1 ? '' : text.slice(firstNewline + 1)
    }
    return text.split('\n')
  } finally {
    await handle.close()
  }
}

function resolveProject(
  projects: readonly Project[],
  cwd: string,
  repository: string | null,
): Project | null {
  return (
    projects
      .filter((project) => cwd === project.directory || cwd.startsWith(`${project.directory}/`))
      .sort((left, right) => right.directory.length - left.directory.length)[0] ??
    projects.find((project) => repository && project.repository === repository) ??
    null
  )
}

function sessionTitle(name: string | null, title: string, preview: string): string {
  const raw = name?.trim() || title.trim() || preview.trim() || 'Untitled Codex session'
  const singleLine = raw.replace(/\s+/g, ' ')
  return singleLine.length > 84 ? `${singleLine.slice(0, 81).trimEnd()}…` : singleLine
}
