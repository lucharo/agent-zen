import { open, stat } from 'node:fs/promises'
import type { PlanStepStatus, SessionCollaborationMode } from '../../src/domain/types'
import { stageHintFromMessage, type StageHint } from '../shared/stageHint'

/**
 * What Agent Zen reads from a Claude Code transcript
 * (`~/.claude/projects/<slug>/<sessionId>.jsonl`).
 *
 * The file is append-only, so the observer parses it forward once and then
 * only the bytes appended since the last poll. Liveness and busy/waiting come
 * from the registry, not from here; this is the turn anchor, titles, mode, the
 * workflow stage that was invoked and the task list.
 */
export interface ClaudeTask {
  readonly id: string
  readonly subject: string
  readonly status: PlanStepStatus
}

interface PendingTaskCall {
  readonly name: 'TaskCreate' | 'TaskUpdate'
  readonly input: Readonly<Record<string, unknown>>
}

export interface ClaudeTranscriptSnapshot {
  readonly turnId: string | null
  readonly turnStartedAt: string | null
  readonly hasSubstantiveActivity: boolean
  readonly collaborationMode: SessionCollaborationMode
  readonly customTitle: string | null
  readonly aiTitle: string | null
  readonly firstPrompt: string | null
  readonly latestPrompt: string | null
  readonly model: string | null
  readonly cliVersion: string | null
  readonly branch: string | null
  readonly stageHint: StageHint
  /**
   * Set once a wrap-up starts (a `/wrapup` command or the agent loading the
   * wrapup skill). It holds for the rest of the session: the short replies that
   * finish a wrap-up are new turns, and they must not drop the card back to work.
   */
  readonly wrapupStarted: boolean
  /** The task list as TaskCreate and TaskUpdate left it, in id order. */
  readonly tasks: readonly ClaudeTask[]
  /** Accepted task changes so far; 0 means the transcript never used the task tools. */
  readonly tasksRevision: number
  readonly tasksUpdatedAt: string | null
  /** Task tool calls still waiting for their result, keyed by tool_use id. */
  readonly pendingTaskCalls: Readonly<Record<string, PendingTaskCall>>
}

export const EMPTY_TRANSCRIPT: ClaudeTranscriptSnapshot = {
  turnId: null,
  turnStartedAt: null,
  hasSubstantiveActivity: false,
  collaborationMode: 'default',
  customTitle: null,
  aiTitle: null,
  firstPrompt: null,
  latestPrompt: null,
  model: null,
  cliVersion: null,
  branch: null,
  stageHint: null,
  wrapupStarted: false,
  tasks: [],
  tasksRevision: 0,
  tasksUpdatedAt: null,
  pendingTaskCalls: {},
}

interface TranscriptRecord {
  readonly type?: unknown
  readonly uuid?: unknown
  readonly timestamp?: unknown
  readonly isMeta?: unknown
  readonly isSidechain?: unknown
  readonly isApiErrorMessage?: unknown
  readonly isCompactSummary?: unknown
  readonly origin?: unknown
  readonly promptSource?: unknown
  readonly toolUseResult?: unknown
  readonly sourceToolUseID?: unknown
  readonly version?: unknown
  readonly gitBranch?: unknown
  readonly permissionMode?: unknown
  readonly aiTitle?: unknown
  readonly customTitle?: unknown
  readonly message?: unknown
}

/** Fold one JSONL record into the running snapshot. Exported for tests. */
export function applyTranscriptRecord(
  snapshot: ClaudeTranscriptSnapshot,
  line: string,
): ClaudeTranscriptSnapshot {
  const record = parseRecord(line)
  return record ? applyRecord(snapshot, record) : snapshot
}

function parseRecord(line: string): TranscriptRecord | null {
  if (!line.trim()) return null
  try {
    const record = JSON.parse(line) as TranscriptRecord
    return record && typeof record === 'object' ? record : null
  } catch {
    return null
  }
}

function applyRecord(snapshot: ClaudeTranscriptSnapshot, record: TranscriptRecord): ClaudeTranscriptSnapshot {
  let next = snapshot
  if (typeof record.version === 'string' && record.version) next = { ...next, cliVersion: record.version }
  if (typeof record.gitBranch === 'string' && record.gitBranch) next = { ...next, branch: record.gitBranch }

  switch (record.type) {
    case 'user': {
      if (record.isSidechain !== true) next = applyTaskResults(next, record)
      const text = humanPromptText(record)
      if (text === null) return next
      const promptHint = stageHintFromClaudePrompt(text)
      const wrapupStarted = next.wrapupStarted || promptHint === 'wrapping-up'
      return {
        ...next,
        turnId: typeof record.uuid === 'string' ? record.uuid : next.turnId,
        turnStartedAt: typeof record.timestamp === 'string' ? record.timestamp : next.turnStartedAt,
        hasSubstantiveActivity: false,
        firstPrompt: next.firstPrompt ?? text,
        latestPrompt: text,
        wrapupStarted,
        stageHint: wrapupStarted ? 'wrapping-up' : promptHint,
      }
    }
    case 'assistant': {
      if (record.isSidechain === true || record.isApiErrorMessage === true) return next
      const message = isObject(record.message) ? record.message : null
      const model = message && typeof message.model === 'string' && !message.model.startsWith('<')
        ? message.model
        : next.model
      next = { ...next, hasSubstantiveActivity: true, model }
      for (const block of Array.isArray(message?.content) ? message.content : []) {
        if (!isObject(block) || block.type !== 'tool_use') continue
        const input = isObject(block.input) ? block.input : {}
        if (block.name === 'Skill') next = applySkillInvocation(next, input.skill)
        if ((block.name === 'TaskCreate' || block.name === 'TaskUpdate') && typeof block.id === 'string') {
          next = { ...next, pendingTaskCalls: { ...next.pendingTaskCalls, [block.id]: { name: block.name, input } } }
        }
      }
      return next
    }
    case 'permission-mode':
      return {
        ...next,
        collaborationMode: record.permissionMode === 'plan' ? 'plan' : 'default',
      }
    case 'ai-title':
      return typeof record.aiTitle === 'string' && record.aiTitle.trim()
        ? { ...next, aiTitle: record.aiTitle.trim() }
        : next
    case 'custom-title':
      return typeof record.customTitle === 'string' && record.customTitle.trim()
        ? { ...next, customTitle: record.customTitle.trim() }
        : next
    default:
      return next
  }
}

/**
 * The text of a prompt a human sent that starts a turn, or null for anything
 * else that shares the `user` record type: tool results, injected context,
 * sidechain traffic, compaction summaries, background-task notifications,
 * local command output, bash-mode input and interruption markers.
 */
export function humanPromptText(record: TranscriptRecord): string | null {
  if (record.isMeta === true || record.isSidechain === true || record.isCompactSummary === true) return null
  if (record.toolUseResult !== undefined || record.sourceToolUseID !== undefined) return null
  // Recent versions label provenance; older ones leave it out, so absence is not a rejection.
  const origin = isObject(record.origin) ? record.origin.kind : undefined
  if ((origin !== undefined && origin !== 'human') || record.promptSource === 'system') return null
  const message = isObject(record.message) ? record.message : null
  if (!message || message.role !== 'user') return null
  const content = message.content
  let text: string
  if (typeof content === 'string') {
    text = content
  } else if (Array.isArray(content)) {
    if (content.some((block) => isObject(block) && block.type === 'tool_result')) return null
    text = content
      .flatMap((block) => (isObject(block) && block.type === 'text' && typeof block.text === 'string' ? [block.text] : []))
      .join('\n')
  } else {
    return null
  }
  if (NOT_A_PROMPT.test(text) || slashCommand(text)?.local) return null
  const plain = plainPromptText(text)
  return plain ? plain : null
}

const NOT_A_PROMPT = /^\s*(?:<(?:local-command-[a-z]+|bash-[a-z]+|task-notification|ci-monitor-event)>|\[Request interrupted by user)/i
const COMMAND_WRAPPER = /^\s*(?:<command-(name|message|args)>[\s\S]*?<\/command-\1>\s*)+$/i

export interface SlashCommand {
  readonly name: string
  readonly args: string
  /** A built-in that runs in the terminal and never reaches the model, so it starts no turn. */
  readonly local: boolean
}

/**
 * Claude Code wraps a typed slash command in tags. Built-in local commands
 * (`/model`, `/effort`, `/compact`) lead with `<command-name>` and are followed
 * by their terminal output; skill and prompt commands (`/wrapup`) lead with
 * `<command-message>` and start a turn. Observed on 2.1.259 to 2.1.282.
 */
export function slashCommand(text: string): SlashCommand | null {
  // Every real wrapper carries both tags; a lone one is quoted markup, not an invocation.
  if (!COMMAND_WRAPPER.test(text) || !/<command-message>/i.test(text)) return null
  const name = text.match(/<command-name>\s*\/?([^<\s]+)\s*<\/command-name>/i)?.[1]
  if (!name) return null
  return {
    name: `/${name}`,
    args: text.match(/<command-args>([\s\S]*?)<\/command-args>/i)?.[1]?.trim() ?? '',
    local: /^\s*<command-name>/i.test(text),
  }
}

/** Slash commands arrive wrapped in tags; render them the way the user typed them. */
export function plainPromptText(text: string): string {
  const command = slashCommand(text)
  if (command) return command.args ? `${command.name} ${command.args}` : command.name
  return text.replace(/<[a-z-]+-reminder>[\s\S]*?<\/[a-z-]+-reminder>/gi, '').trim()
}

/**
 * A human-invoked workflow stage. The tag form is what Claude Code writes for a
 * typed slash command; plain prose falls through to the shared prompt parser.
 */
export function stageHintFromClaudePrompt(text: string): StageHint {
  const command = text.match(/^\/([a-z0-9:_-]+)/i)?.[1]
  return command ? workflowStage(command) : stageHintFromMessage(text)
}

/**
 * The stage a loaded skill puts a session in. Loading a skill through the
 * `Skill` tool is how a spoken "wrap up" reaches the workflow, so it counts
 * the same as typing the command; reading or mentioning a skill does not.
 */
export function stageHintFromSkill(skill: unknown): StageHint {
  return typeof skill === 'string' && skill ? workflowStage(skill.replace(/^\//, '')) : null
}

function workflowStage(name: string): StageHint {
  const lower = name.toLowerCase()
  const bare = lower.includes(':') ? lower.slice(lower.indexOf(':') + 1) : lower
  if (bare === 'wrapup') return 'wrapping-up'
  if (bare === 'webapp-agent-demo' || /(?:^|-)review(?:-|$)/.test(bare)) return 'reviewing'
  return null
}

/** Wrap-up holds for the session; a review lasts for its turn and never displaces a wrap-up. */
function applySkillInvocation(snapshot: ClaudeTranscriptSnapshot, skill: unknown): ClaudeTranscriptSnapshot {
  const hint = stageHintFromSkill(skill)
  if (hint === 'wrapping-up') return { ...snapshot, wrapupStarted: true, stageHint: 'wrapping-up' }
  if (hint === 'reviewing' && snapshot.stageHint !== 'wrapping-up') return { ...snapshot, stageHint: 'reviewing' }
  return snapshot
}

/**
 * Pair task tool results with their calls. TaskCreate's result carries the new
 * task's id; a TaskUpdate counts only once its result reports success.
 */
function applyTaskResults(snapshot: ClaudeTranscriptSnapshot, record: TranscriptRecord): ClaudeTranscriptSnapshot {
  const message = isObject(record.message) ? record.message : null
  const result = isObject(record.toolUseResult) ? record.toolUseResult : null
  const timestamp = typeof record.timestamp === 'string' ? record.timestamp : snapshot.tasksUpdatedAt
  let next = snapshot
  for (const block of Array.isArray(message?.content) ? message.content : []) {
    if (!isObject(block) || block.type !== 'tool_result' || typeof block.tool_use_id !== 'string') continue
    const call = next.pendingTaskCalls[block.tool_use_id]
    if (!call) continue
    const { [block.tool_use_id]: _answered, ...pendingTaskCalls } = next.pendingTaskCalls
    next = { ...next, pendingTaskCalls }
    const tasks = call.name === 'TaskCreate' ? createdTasks(next.tasks, result) : updatedTasks(next.tasks, call.input, result)
    if (tasks) next = { ...next, tasks, tasksRevision: next.tasksRevision + 1, tasksUpdatedAt: timestamp }
  }
  return next
}

function createdTasks(tasks: readonly ClaudeTask[], result: Record<string, unknown> | null): ClaudeTask[] | null {
  const task = result && isObject(result.task) ? result.task : null
  const id = task && (typeof task.id === 'string' || typeof task.id === 'number') ? String(task.id) : null
  const subject = task && typeof task.subject === 'string' ? task.subject.trim() : ''
  if (!id || !subject) return null
  return [...tasks.filter((existing) => existing.id !== id), { id, subject, status: 'pending' as const }]
    .sort((left, right) => Number(left.id) - Number(right.id) || left.id.localeCompare(right.id))
}

function updatedTasks(
  tasks: readonly ClaudeTask[],
  input: Readonly<Record<string, unknown>>,
  result: Record<string, unknown> | null,
): ClaudeTask[] | null {
  if (result?.success !== true) return null
  const id = typeof input.taskId === 'string' || typeof input.taskId === 'number' ? String(input.taskId) : null
  if (!id || !tasks.some((task) => task.id === id)) return null
  if (input.status === 'deleted') return tasks.filter((task) => task.id !== id)
  return tasks.map((task) => {
    if (task.id !== id) return task
    const status = input.status === 'pending' || input.status === 'in_progress' || input.status === 'completed'
      ? input.status
      : task.status
    const subject = typeof input.subject === 'string' && input.subject.trim() ? input.subject.trim() : task.subject
    return { ...task, status, subject }
  })
}

interface CachedTranscript {
  /** A replaced file is reparsed from the start, never resumed mid-record. */
  readonly inode: number
  readonly size: number
  readonly modifiedAt: number
  /** Byte offset up to which whole lines have been folded in. */
  readonly parsedTo: number
  /** The cached offset is inside a record that exceeded the configured bound. */
  readonly discardingRecord: boolean
  readonly snapshot: ClaudeTranscriptSnapshot
  /** The earlier segments this file was folded on top of; a change there means a full reparse. */
  readonly seedKey: string
  /** Record uuids in this file, so a later segment can skip the history it copied. */
  readonly uuids: ReadonlySet<string>
}

const NO_UUIDS: ReadonlySet<string> = new Set()

const READ_CHUNK_BYTES = 1024 * 1024
const MAX_TRANSCRIPT_RECORD_BYTES = 4 * 1024 * 1024

export interface ClaudeTranscriptReaderOptions {
  readonly maxRecordBytes?: number
}

/** Incremental reader: parses each transcript once, then only appended bytes. */
export class ClaudeTranscriptReader {
  private readonly cache = new Map<string, CachedTranscript>()

  constructor(private readonly options: ClaudeTranscriptReaderOptions = {}) {}

  /**
   * Fold one transcript file. A resumed session's later segment is folded on
   * top of the earlier ones (`seed`, identified by `seedKey`), skipping records
   * whose uuid an earlier segment already carried.
   */
  async read(
    filePath: string,
    seed: ClaudeTranscriptSnapshot = EMPTY_TRANSCRIPT,
    seedKey = '',
    skipUuids: ReadonlySet<string> = NO_UUIDS,
  ): Promise<ClaudeTranscriptSnapshot> {
    const metadata = await stat(filePath).catch(() => null)
    if (!metadata) return seed
    const known = this.cache.get(filePath)
    const cached = known && known.inode === metadata.ino && known.seedKey === seedKey ? known : undefined
    if (cached && cached.size === metadata.size && cached.modifiedAt === metadata.mtimeMs) {
      return cached.snapshot
    }
    const resumable = cached && cached.parsedTo <= metadata.size ? cached : null
    let snapshot = resumable?.snapshot ?? seed
    let position = resumable?.parsedTo ?? 0
    let discardingRecord = resumable?.discardingRecord ?? false
    const uuids = new Set(resumable?.uuids ?? NO_UUIDS)
    const maxRecordBytes = this.options.maxRecordBytes ?? MAX_TRANSCRIPT_RECORD_BYTES
    const handle = await open(filePath, 'r')
    try {
      let carry = Buffer.alloc(0)
      while (position < metadata.size) {
        const length = Math.min(READ_CHUNK_BYTES, metadata.size - position)
        const bytes = Buffer.alloc(length)
        const { bytesRead } = await handle.read(bytes, 0, length, position)
        if (bytesRead === 0) break
        const block = bytes.subarray(0, bytesRead)
        let lineStart = 0
        if (discardingRecord) {
          const discardedEnd = block.indexOf(0x0a)
          if (discardedEnd < 0) {
            position += bytesRead
            continue
          }
          discardingRecord = false
          lineStart = discardedEnd + 1
        }
        while (lineStart < block.length) {
          const lineEnd = block.indexOf(0x0a, lineStart)
          if (lineEnd < 0) {
            const tail = block.subarray(lineStart)
            if (carry.length + tail.length > maxRecordBytes) {
              carry = Buffer.alloc(0)
              discardingRecord = true
            } else {
              carry = carry.length > 0 ? Buffer.concat([carry, tail]) : tail
            }
            break
          }
          const segment = block.subarray(lineStart, lineEnd)
          if (carry.length + segment.length <= maxRecordBytes) {
            const line = carry.length > 0 ? Buffer.concat([carry, segment]) : segment
            const record = parseRecord(line.toString('utf8'))
            const uuid = typeof record?.uuid === 'string' ? record.uuid : null
            if (uuid) uuids.add(uuid)
            if (record && !(uuid && skipUuids.has(uuid))) snapshot = applyRecord(snapshot, record)
          }
          carry = Buffer.alloc(0)
          lineStart = lineEnd + 1
        }
        position += bytesRead
      }
      const parsedTo = position - carry.length
      this.cache.set(filePath, {
        inode: metadata.ino,
        size: metadata.size,
        modifiedAt: metadata.mtimeMs,
        parsedTo,
        discardingRecord,
        snapshot,
        seedKey,
        uuids,
      })
    } finally {
      await handle.close()
    }
    return snapshot
  }

  /** Identity of the file as last folded, used to key the segments folded on top of it. */
  signature(filePath: string): string {
    const cached = this.cache.get(filePath)
    return cached ? `${filePath}:${cached.inode}:${cached.size}:${cached.modifiedAt};` : `${filePath}:missing;`
  }

  uuidsOf(filePath: string): ReadonlySet<string> {
    return this.cache.get(filePath)?.uuids ?? NO_UUIDS
  }

  forget(filePath: string): void {
    this.cache.delete(filePath)
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
