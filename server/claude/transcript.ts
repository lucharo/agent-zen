import { open, stat } from 'node:fs/promises'
import type { SessionCollaborationMode } from '../../src/domain/types'
import { stageHintFromMessage, type StageHint } from '../shared/stageHint'

/**
 * What Agent Zen reads from a Claude Code transcript
 * (`~/.claude/projects/<slug>/<sessionId>.jsonl`).
 *
 * The file is append-only, so the observer parses it forward once and then
 * only the bytes appended since the last poll. Liveness and busy/waiting come
 * from the registry, not from here; this is the turn anchor, titles, mode and
 * the explicit workflow stage a human invoked.
 */
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
}

interface TranscriptRecord {
  readonly type?: unknown
  readonly uuid?: unknown
  readonly timestamp?: unknown
  readonly isMeta?: unknown
  readonly isSidechain?: unknown
  readonly isApiErrorMessage?: unknown
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
  if (!line.trim()) return snapshot
  let record: TranscriptRecord
  try {
    record = JSON.parse(line) as TranscriptRecord
  } catch {
    return snapshot
  }
  if (!record || typeof record !== 'object') return snapshot
  let next = snapshot
  if (typeof record.version === 'string' && record.version) next = { ...next, cliVersion: record.version }
  if (typeof record.gitBranch === 'string' && record.gitBranch) next = { ...next, branch: record.gitBranch }

  switch (record.type) {
    case 'user': {
      const text = humanPromptText(record)
      if (text === null) return next
      return {
        ...next,
        turnId: typeof record.uuid === 'string' ? record.uuid : next.turnId,
        turnStartedAt: typeof record.timestamp === 'string' ? record.timestamp : next.turnStartedAt,
        hasSubstantiveActivity: false,
        firstPrompt: next.firstPrompt ?? text,
        latestPrompt: text,
        stageHint: stageHintFromClaudePrompt(text),
      }
    }
    case 'assistant': {
      if (record.isSidechain === true || record.isApiErrorMessage === true) return next
      const message = isObject(record.message) ? record.message : null
      const model = message && typeof message.model === 'string' && !message.model.startsWith('<')
        ? message.model
        : next.model
      return { ...next, hasSubstantiveActivity: true, model }
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
 * The text of a prompt a human sent, or null for anything else that shares the
 * `user` record type: tool results, injected context, sidechain traffic.
 */
export function humanPromptText(record: TranscriptRecord): string | null {
  if (record.isMeta === true || record.isSidechain === true) return null
  if (record.toolUseResult !== undefined || record.sourceToolUseID !== undefined) return null
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
  const plain = plainPromptText(text)
  return plain ? plain : null
}

const COMMAND_NAME = /<command-name>\s*(\/[^<\s]+)\s*<\/command-name>/i
const COMMAND_ARGS = /<command-args>([\s\S]*?)<\/command-args>/i

/** Slash commands arrive wrapped in tags; render them the way the user typed them. */
export function plainPromptText(text: string): string {
  const command = text.match(COMMAND_NAME)
  if (command?.[1]) {
    const args = text.match(COMMAND_ARGS)?.[1]?.trim() ?? ''
    return args ? `${command[1]} ${args}` : command[1]
  }
  return text.replace(/<[a-z-]+-reminder>[\s\S]*?<\/[a-z-]+-reminder>/gi, '').trim()
}

/**
 * A human-invoked workflow stage. The tag form is what Claude Code writes for a
 * typed slash command; plain prose falls through to the shared prompt parser.
 */
export function stageHintFromClaudePrompt(text: string): StageHint {
  const command = text.match(/^\/([a-z0-9:_-]+)/i)?.[1]?.toLowerCase()
  if (command) {
    const bare = command.includes(':') ? command.slice(command.indexOf(':') + 1) : command
    if (bare === 'wrapup') return 'wrapping-up'
    if (bare === 'webapp-agent-demo' || /(?:^|-)review(?:-|$)/.test(bare)) return 'reviewing'
    return null
  }
  return stageHintFromMessage(text)
}

interface CachedTranscript {
  readonly size: number
  readonly modifiedAt: number
  /** Byte offset up to which whole lines have been folded in. */
  readonly parsedTo: number
  readonly snapshot: ClaudeTranscriptSnapshot
}

const READ_CHUNK_BYTES = 1024 * 1024

/** Incremental reader: parses each transcript once, then only appended bytes. */
export class ClaudeTranscriptReader {
  private readonly cache = new Map<string, CachedTranscript>()

  async read(filePath: string): Promise<ClaudeTranscriptSnapshot> {
    const metadata = await stat(filePath).catch(() => null)
    if (!metadata) return EMPTY_TRANSCRIPT
    const cached = this.cache.get(filePath)
    if (cached && cached.size === metadata.size && cached.modifiedAt === metadata.mtimeMs) {
      return cached.snapshot
    }
    const resumable = cached && cached.parsedTo <= metadata.size ? cached : null
    let snapshot = resumable?.snapshot ?? EMPTY_TRANSCRIPT
    let position = resumable?.parsedTo ?? 0
    const handle = await open(filePath, 'r')
    try {
      let carry = ''
      while (position < metadata.size) {
        const length = Math.min(READ_CHUNK_BYTES, metadata.size - position)
        const bytes = Buffer.alloc(length)
        const { bytesRead } = await handle.read(bytes, 0, length, position)
        if (bytesRead === 0) break
        const text = carry + bytes.subarray(0, bytesRead).toString('utf8')
        const lines = text.split('\n')
        carry = lines.pop() ?? ''
        for (const line of lines) snapshot = applyTranscriptRecord(snapshot, line)
        position += bytesRead
      }
      const parsedTo = position - Buffer.byteLength(carry, 'utf8')
      this.cache.set(filePath, {
        size: metadata.size,
        modifiedAt: metadata.mtimeMs,
        parsedTo,
        snapshot,
      })
    } finally {
      await handle.close()
    }
    return snapshot
  }

  forget(filePath: string): void {
    this.cache.delete(filePath)
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
