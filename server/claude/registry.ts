import { execFile } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'

/**
 * Claude Code writes `~/.claude/sessions/<pid>.json` for every process it runs
 * and rewrites it on each status change. Nothing here is configured by Agent
 * Zen; the file is the stock binary's own registry, read as-is.
 */
export type ClaudeRegistryStatus = 'busy' | 'waiting' | 'idle' | 'exited' | 'stopped'

export interface ClaudeRegistryEntry {
  readonly pid: number
  readonly sessionId: string
  readonly cwd: string
  /** Epoch milliseconds. */
  readonly startedAt: number
  readonly version: string | null
  readonly kind: string | null
  readonly entrypoint: string | null
  readonly name: string | null
  readonly nameSource: string | null
  readonly status: ClaudeRegistryStatus
  readonly waitingFor: string | null
  /** Epoch milliseconds of the last status change. */
  readonly statusUpdatedAt: number
}

const STATUSES: readonly ClaudeRegistryStatus[] = ['busy', 'waiting', 'idle', 'exited', 'stopped']

export function parseRegistryEntry(text: string): ClaudeRegistryEntry | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const pid = record.pid
  const sessionId = record.sessionId
  const cwd = record.cwd
  const status = record.status
  if (
    typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0 ||
    typeof sessionId !== 'string' || !sessionId ||
    typeof cwd !== 'string' || !cwd ||
    typeof status !== 'string' || !STATUSES.includes(status as ClaudeRegistryStatus)
  ) {
    return null
  }
  const startedAt = typeof record.startedAt === 'number' ? record.startedAt : Date.now()
  return {
    pid,
    sessionId,
    cwd,
    startedAt,
    version: stringOrNull(record.version),
    kind: stringOrNull(record.kind),
    entrypoint: stringOrNull(record.entrypoint),
    name: stringOrNull(record.name),
    nameSource: stringOrNull(record.nameSource),
    status: status as ClaudeRegistryStatus,
    waitingFor: stringOrNull(record.waitingFor),
    statusUpdatedAt: typeof record.statusUpdatedAt === 'number'
      ? record.statusUpdatedAt
      : typeof record.updatedAt === 'number'
        ? record.updatedAt
        : startedAt,
  }
}

export interface ReadRegistryOptions {
  readonly directory: string
  /** Defaults to `process.kill(pid, 0)`; injectable so tests can pretend a pid died. */
  readonly isProcessAlive?: (pid: number) => boolean
  /** Defaults to a bounded `ps` lookup; used to reject stale registry files after PID reuse. */
  readonly processName?: (pid: number) => string | null | Promise<string | null>
}

export interface ClaudeProcessRejection {
  readonly pid: number
  readonly sessionId: string
  readonly command: string | null
}

export interface ClaudeRegistrySnapshot {
  readonly entries: readonly ClaudeRegistryEntry[]
  readonly processRejections: readonly ClaudeProcessRejection[]
}

/**
 * Every interactive Claude Code session whose process is still alive.
 * Returns `null` when the registry directory cannot be read at all, so the
 * caller can distinguish "no sessions" from "no Claude Code here".
 */
export async function readLiveRegistry(
  options: ReadRegistryOptions,
): Promise<ClaudeRegistrySnapshot | null> {
  const alive = options.isProcessAlive ?? processIsAlive
  const processName = options.processName ?? processNameForPid
  let names: string[]
  try {
    names = await readdir(options.directory)
  } catch {
    return null
  }
  const entries = await Promise.all(
    names
      .filter((name) => /^\d+\.json$/.test(name))
      .map(async (name) => {
        const text = await readFile(join(options.directory, name), 'utf8').catch(() => null)
        return text === null ? null : parseRegistryEntry(text)
      }),
  )
  const candidates = entries
    .filter((entry): entry is ClaudeRegistryEntry => entry !== null)
    .filter((entry) => entry.kind === null || entry.kind === 'interactive')
    .filter((entry) => entry.status === 'busy' || entry.status === 'waiting' || entry.status === 'idle')
    .filter((entry) => alive(entry.pid))
  const identified = await Promise.all(candidates.map(async (entry) => ({
    entry,
    command: await processName(entry.pid),
  })))
  return {
    entries: identified
      .filter(({ command }) => isClaudeProcess(command))
      .map(({ entry }) => entry)
      .sort((left, right) => right.startedAt - left.startedAt),
    processRejections: identified
      .filter(({ command }) => !isClaudeProcess(command))
      .map(({ entry, command }) => ({ pid: entry.pid, sessionId: entry.sessionId, command })),
  }
}

const execFileAsync = promisify(execFile)

async function processNameForPid(pid: number): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('/bin/ps', ['-p', String(pid), '-o', 'comm='], {
      encoding: 'utf8',
      timeout: 1_000,
    })
    return stdout.trim() || null
  } catch {
    return null
  }
}

function isClaudeProcess(command: string | null): boolean {
  return command !== null && /^claude(?:$|[-.])/i.test(basename(command))
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}
