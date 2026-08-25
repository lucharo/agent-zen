import { Database } from 'bun:sqlite'
import { open, stat } from 'node:fs/promises'
import type { AgentSession, Project } from '../../src/domain/types'
import { normaliseGitHubRepository } from '../projects'
import { discoverActiveCodexThreadIds } from './processInventory'
import { goalRecordAnchor, parseRolloutLines, type RolloutSnapshot } from './rollout'

const DEFAULT_ROLLOUT_TAIL_BYTES = 64 * 1024

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
  readonly turnStartLine: string | null
  readonly lifecycleLine: string | null
  readonly planLine: string | null
  readonly stageLine: string | null
  readonly modeLine: string | null
  readonly activityLine: string | null
  readonly goalLines: readonly string[]
  readonly goalHistorySearched: boolean
  readonly inputLines: readonly string[]
}

export interface CodexStateObserverOptions {
  readonly dbPath: string
  readonly getProjects: () => readonly Project[] | Promise<readonly Project[]>
  readonly maxThreads?: number
  readonly maxRolloutBytes?: number
  readonly getActiveThreadIds?: () => Promise<ReadonlySet<string> | null>
  readonly readGoalHistory?: (filePath: string, size: number) => Promise<string[]>
}

/** Read-only cross-process observer for Codex threads and rollout tails. */
export class CodexStateObserver {
  private readonly cache = new Map<string, CachedRollout>()
  private lastActiveThreadIds: ReadonlySet<string> | null = null

  constructor(private readonly options: CodexStateObserverOptions) {}

  async snapshot(): Promise<AgentSession[]> {
    const [discoveredThreadIds, projects] = await Promise.all([
      this.options.getActiveThreadIds?.() ?? discoverActiveCodexThreadIds(),
      this.options.getProjects(),
    ])
    if (discoveredThreadIds !== null) this.lastActiveThreadIds = discoveredThreadIds
    const activeThreadIds = discoveredThreadIds ?? this.lastActiveThreadIds
    const rows = this.readRows(activeThreadIds)
    const sessions: AgentSession[] = []
    for (const row of rows) {
      sessions.push(await this.toSession(row, projects, activeThreadIds !== null))
    }
    return activeThreadIds === null
      ? sessions.filter((session) => session.activity === 'working' || session.activity === 'awaiting-input')
      : sessions
  }

  private readRows(activeThreadIds: ReadonlySet<string> | null): ThreadRow[] {
    const database = new Database(this.options.dbPath, { readonly: true })
    try {
      if (activeThreadIds !== null) {
        if (activeThreadIds.size === 0) return []
        const query = database.query<ThreadRow, [string]>(`
          SELECT
            t.id, t.rollout_path, t.created_at, t.updated_at, t.cwd, t.title,
            t.preview, t.name, t.model_provider, t.model, t.reasoning_effort,
            t.cli_version, t.git_branch, t.git_origin_url, t.created_at_ms,
            t.updated_at_ms, e.parent_thread_id
          FROM threads t
          LEFT JOIN thread_spawn_edges e ON e.child_thread_id = t.id
          WHERE t.archived = 0
            AND t.id IN (SELECT value FROM json_each(?))
            AND NOT (
              t.source = 'exec'
              AND lower(trim(t.title)) LIKE 'you are a code reviewer. review the code changes shown below.%'
            )
          ORDER BY COALESCE(t.updated_at_ms, t.updated_at * 1000) DESC
        `)
        return query.all(JSON.stringify([...activeThreadIds]))
      }

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
    processActive: boolean,
  ): Promise<AgentSession> {
    const rollout = await this.rollout(row.rollout_path)
    const createdMs = row.created_at_ms ?? row.created_at * 1000
    const updatedMs = row.updated_at_ms ?? row.updated_at * 1000
    const repository = normaliseGitHubRepository(row.git_origin_url)
    const project = resolveProject(projects, row.cwd, repository)
    const turnActive = rollout.activity === 'working' || rollout.activity === 'awaiting-input'
    const review = rollout.stageHint === 'reviewing'
      ? { visualChecked: null, prReady: null, openNotes: null, pullRequest: null }
      : null
    const wrapup = rollout.stageHint === 'wrapping-up'
      ? { checksPassed: null, checksTotal: null }
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
      activity: turnActive ? rollout.activity : processActive ? 'idle' : 'ended',
      collaborationMode: rollout.collaborationMode,
      turnOutcome: rollout.turnOutcome,
      hasSubstantiveActivity: rollout.hasSubstantiveActivity,
      parentSessionId: row.parent_thread_id,
      cwd: row.cwd,
      repository,
      branch: row.git_branch,
      worktree: row.cwd,
      projectId: project?.id ?? null,
      plan: rollout.plan,
      planHistory: rollout.planHistory,
      goal: rollout.goal,
      review,
      wrapup,
      endedAt: turnActive || processActive
        ? null
        : rollout.endedAt ?? new Date(updatedMs).toISOString(),
    }
  }

  private async rollout(rolloutPath: string): Promise<RolloutSnapshot> {
    const metadata = await stat(rolloutPath).catch(() => null)
    if (!metadata) return parseRolloutLines([])
    const cached = this.cache.get(rolloutPath)
    if (cached && cached.size === metadata.size && cached.modifiedAt === metadata.mtimeMs) {
      return cached.snapshot
    }
    const previous = cached && cached.size <= metadata.size ? cached : null

    const lines = await readTail(rolloutPath, this.options.maxRolloutBytes ?? DEFAULT_ROLLOUT_TAIL_BYTES)
    const tailTurnStart = lastTurnStartLine(lines)
    const tailLifecycle = lastLifecycleLine(lines)
    const scanned = !tailTurnStart
      ? await findCurrentTurnAnchors(rolloutPath, metadata.size, previous?.size ?? 0)
      : null
    const turnStartLine =
      tailTurnStart ?? scanned?.turnStartLine ?? previous?.turnStartLine ?? null
    const lifecycleLine =
      tailLifecycle ?? scanned?.lifecycleLine ?? previous?.lifecycleLine ?? turnStartLine
    const tailPlan = lastPlanLine(lines)
    const sameTurn = previous?.turnStartLine === turnStartLine
    let planLine = tailPlan ?? scanned?.planLine ?? (sameTurn ? previous?.planLine ?? null : null)
    const tailStage = lastStageLine(lines)
    let stageLine = tailStage ?? scanned?.stageLine ?? (sameTurn ? previous?.stageLine ?? null : null)
    const tailMode = lastModeLine(lines)
    let modeLine = tailMode ?? scanned?.modeLine ?? (sameTurn ? previous?.modeLine ?? null : null)
    const tailActivity = lastActivityLine(lines)
    let activityLine = tailActivity ?? scanned?.activityLine ?? (sameTurn ? previous?.activityLine ?? null : null)
    const tailGoalLines = lastGoalLines(lines)
    const tailHasUnpairedGoalResult = tailGoalLines.length === 0 && lines.some((line) =>
      goalRecordAnchor(line)?.kind === 'result'
    )
    const scannedGoalLines = lastGoalLines(scanned?.goalLines ?? [])
    const scannedHasUnpairedGoalResult = scannedGoalLines.length === 0 &&
      (scanned?.goalLines ?? []).some((line) => goalRecordAnchor(line)?.kind === 'result')
    let goalHistorySearched = previous?.goalHistorySearched ?? false
    let goalLines = tailGoalLines.length > 0
      ? tailGoalLines
      : tailHasUnpairedGoalResult || scannedHasUnpairedGoalResult
        ? []
        : scannedGoalLines.length > 0
          ? scannedGoalLines
          : [...(previous?.goalLines ?? [])]
    if (
      goalLines.length === 0
      && (tailHasUnpairedGoalResult || scannedHasUnpairedGoalResult || !goalHistorySearched)
    ) {
      goalLines = await (this.options.readGoalHistory ?? findLastGoalLines)(
        rolloutPath,
        metadata.size,
      )
      goalHistorySearched = true
    }
    const cachedInputs = sameTurn ? [...(previous?.inputLines ?? [])] : []
    const resolvedInputIds = new Set(scanned?.resolvedInputIds ?? [])
    let inputLines = [
      ...cachedInputs.filter((line) => {
        const callId = inputRequestCallId(line)
        return callId ? !resolvedInputIds.has(callId) : false
      }),
      ...(scanned?.inputLines ?? []),
    ]
    if (planLine && !planBelongsToLifecycle(planLine, lifecycleLine)) planLine = null
    if (stageLine && !lineBelongsToLifecycle(stageLine, lifecycleLine)) stageLine = null
    if (modeLine && !lineBelongsToLifecycle(modeLine, lifecycleLine)) modeLine = null
    if (activityLine && !lineBelongsToLifecycle(activityLine, lifecycleLine)) activityLine = null

    const tailLines = new Set(lines)
    const anchors = [
      turnStartLine && turnStartLine !== tailTurnStart ? turnStartLine : null,
      lifecycleLine && lifecycleLine !== tailLifecycle ? lifecycleLine : null,
      planLine && planLine !== tailPlan ? planLine : null,
      stageLine && stageLine !== tailStage ? stageLine : null,
      modeLine && modeLine !== tailMode ? modeLine : null,
      activityLine && activityLine !== tailActivity ? activityLine : null,
      ...goalLines,
      ...inputLines.filter((line) => !tailLines.has(line)),
    ].filter((line): line is string => Boolean(line))
    anchors.sort((left, right) => lineTimestamp(left).localeCompare(lineTimestamp(right)))
    const combined = [...new Set([...anchors, ...lines])]
    const snapshot = parseRolloutLines(combined)
    const pendingInputIds = new Set(snapshot.pendingInputCallIds)
    inputLines = combined.filter((line) => {
      const callId = inputRequestCallId(line)
      return callId ? pendingInputIds.has(callId) : false
    })
    this.cache.set(rolloutPath, {
      size: metadata.size,
      modifiedAt: metadata.mtimeMs,
      snapshot,
      turnStartLine,
      lifecycleLine,
      planLine,
      stageLine,
      modeLine,
      activityLine,
      goalLines,
      goalHistorySearched,
      inputLines,
    })
    return snapshot
  }
}

function lastGoalLines(lines: readonly string[]): string[] {
  const calls = new Map<string, string>()
  let latest: string[] = []
  for (const line of lines) {
    if (!line) continue
    const anchor = goalRecordAnchor(line)
    if (!anchor) continue
    if (anchor.kind === 'call') {
      calls.set(anchor.callId, line)
      continue
    }
    const call = calls.get(anchor.callId)
    if (call) latest = [call, line]
  }
  return latest
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

function lastTurnStartLine(lines: readonly string[]): string | null {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]
    if (line && lifecycleType(line) === 'task_started') return line
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

function lastModeLine(lines: readonly string[]): string | null {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]
    if (line && modeLineType(line)) return line
  }
  return null
}

function lastActivityLine(lines: readonly string[]): string | null {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]
    if (line && activityLineType(line)) return line
  }
  return null
}

interface CurrentTurnAnchors {
  readonly turnStartLine: string | null
  readonly lifecycleLine: string | null
  readonly planLine: string | null
  readonly stageLine: string | null
  readonly modeLine: string | null
  readonly activityLine: string | null
  readonly goalLines: readonly string[]
  readonly inputLines: readonly string[]
  readonly resolvedInputIds: readonly string[]
}

async function findCurrentTurnAnchors(
  filePath: string,
  size: number,
  minimumPosition = 0,
): Promise<CurrentTurnAnchors> {
  let lifecycleLine: string | null = null
  let planLine: string | null = null
  let stageLine: string | null = null
  let modeLine: string | null = null
  let activityLine: string | null = null
  let turnStartLine: string | null = null
  const resolved = new Set<string>()
  const unresolved: string[] = []
  const goalLines: string[] = []
  const continueGoalsAcrossTurn = minimumPosition > 0
  for await (const line of reverseLines(filePath, size, minimumPosition)) {
    if (turnStartLine && !continueGoalsAcrossTurn) break
    if (goalRecordAnchor(line)) goalLines.unshift(line)
    if (turnStartLine) continue
    const lifecycle = lifecycleType(line)
    if (!lifecycleLine && lifecycle) lifecycleLine = line
    if (lifecycle === 'task_started') {
      turnStartLine = line
      continue
    }
    if (!planLine && planLineType(line)) planLine = line
    if (!stageLine && stageLineType(line)) stageLine = line
    if (!modeLine && modeLineType(line)) modeLine = line
    if (!activityLine && activityLineType(line)) activityLine = line
    const outputId = inputResolutionCallId(line)
    if (outputId) resolved.add(outputId)
    const requestId = inputRequestCallId(line)
    if (requestId && !resolved.has(requestId)) unresolved.push(line)
  }
  return {
    turnStartLine,
    lifecycleLine,
    planLine,
    stageLine,
    modeLine,
    activityLine,
    goalLines,
    inputLines: unresolved.reverse(),
    resolvedInputIds: [...resolved],
  }
}

async function findLastGoalLines(filePath: string, size: number): Promise<string[]> {
  const results = new Map<string, string>()
  for await (const line of reverseLines(filePath, size)) {
    const anchor = goalRecordAnchor(line)
    if (!anchor) continue
    if (anchor.kind === 'result') {
      results.set(anchor.callId, line)
      continue
    }
    const result = results.get(anchor.callId)
    if (result) return [line, result]
  }
  return []
}

const REVERSE_SCAN_CHUNK_BYTES = 128 * 1024
const MAX_ANCHOR_LINE_BYTES = 256 * 1024

/** Yield complete JSONL records newest-first without retaining giant tool-output lines. */
async function* reverseLines(
  filePath: string,
  size: number,
  minimumPosition = 0,
): AsyncGenerator<string> {
  const handle = await open(filePath, 'r')
  let position = size
  let carry = Buffer.alloc(0)
  let skippingOversizedLine = false
  try {
    while (position > minimumPosition) {
      const start = Math.max(minimumPosition, position - REVERSE_SCAN_CHUNK_BYTES)
      const length = position - start
      const bytes = Buffer.allocUnsafe(length)
      await handle.read(bytes, 0, length, start)
      const newlines: number[] = []
      for (let index = 0; index < bytes.length; index += 1) {
        if (bytes[index] === 0x0a) newlines.push(index)
      }

      if (newlines.length === 0) {
        if (!skippingOversizedLine) {
          if (bytes.length + carry.length <= MAX_ANCHOR_LINE_BYTES) {
            carry = Buffer.concat([bytes, carry])
          } else {
            carry = Buffer.alloc(0)
            skippingOversizedLine = true
          }
        }
        position = start
        continue
      }

      const lastNewline = newlines[newlines.length - 1]!
      if (!skippingOversizedLine) {
        const suffix = Buffer.concat([bytes.subarray(lastNewline + 1), carry])
        if (suffix.length <= MAX_ANCHOR_LINE_BYTES && suffix.length > 0) {
          yield suffix.toString('utf8')
        }
      }
      for (let index = newlines.length - 1; index > 0; index -= 1) {
        const line = bytes.subarray(newlines[index - 1]! + 1, newlines[index]!)
        if (line.length > 0) yield line.toString('utf8')
      }

      carry = Buffer.from(bytes.subarray(0, newlines[0]!))
      skippingOversizedLine = carry.length > MAX_ANCHOR_LINE_BYTES
      if (skippingOversizedLine) carry = Buffer.alloc(0)
      position = start
    }
    if (!skippingOversizedLine && carry.length > 0) yield carry.toString('utf8')
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
  if (!line.includes('user_message') && !line.includes('SKILL.md')) return false
  return parseRolloutLines([line]).stageHint !== null
}

function modeLineType(line: string): boolean {
  if (!line.includes('collaboration_mode')) return false
  return parseRolloutLines([line]).collaborationMode !== null
}

function activityLineType(line: string): boolean {
  if (!line.includes('agent_message') && !line.includes('response_item')) return false
  return parseRolloutLines([line]).hasSubstantiveActivity
}

function inputRequestCallId(line: string): string | null {
  if (!line.includes('request_user_input')) return null
  try {
    const record = JSON.parse(line) as {
      type?: string
      payload?: { type?: string; name?: string; call_id?: string }
    }
    return record.type === 'response_item' &&
      record.payload?.type === 'function_call' &&
      record.payload.name === 'request_user_input' &&
      typeof record.payload.call_id === 'string'
      ? record.payload.call_id
      : null
  } catch {
    return null
  }
}

function inputResolutionCallId(line: string): string | null {
  if (!line.includes('function_call_output')) return null
  try {
    const record = JSON.parse(line) as {
      type?: string
      payload?: { type?: string; call_id?: string }
    }
    return record.type === 'response_item' &&
      record.payload?.type === 'function_call_output' &&
      typeof record.payload.call_id === 'string'
      ? record.payload.call_id
      : null
  } catch {
    return null
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
