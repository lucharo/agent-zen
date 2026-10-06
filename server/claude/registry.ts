import { execFile } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'

/**
 * Claude Code writes `~/.claude/sessions/<pid>.json` for every process it runs
 * and rewrites it on each status change. Nothing here is configured by Agent
 * Zen; the file is the stock binary's own registry, read as-is.
 *
 * The binary writes `busy`, `waiting` and `idle`, and `shell` for an idle
 * prompt with a background shell still running (2.1.282). A status this
 * reader does not know yet is read as idle rather than dropping a live session.
 */
export type ClaudeRegistryStatus = 'busy' | 'waiting' | 'idle' | 'exited' | 'stopped'

export interface ClaudeRegistryEntry {
  readonly pid: number
  /** Which process table `pid` belongs to; `darwin` for every entry Claude Code writes on a Mac. */
  readonly pidDomain: string | null
  readonly sessionId: string
  readonly cwd: string
  /** Epoch milliseconds. */
  readonly startedAt: number
  /** The process start time as Claude Code recorded it: C-locale `ps -o lstart` in UTC. */
  readonly procStart: string | null
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
    typeof status !== 'string' || !status
  ) {
    return null
  }
  const startedAt = typeof record.startedAt === 'number' ? record.startedAt : Date.now()
  return {
    pid,
    pidDomain: stringOrNull(record.pidDomain),
    sessionId,
    cwd,
    startedAt,
    procStart: stringOrNull(record.procStart),
    version: stringOrNull(record.version),
    kind: stringOrNull(record.kind),
    entrypoint: stringOrNull(record.entrypoint),
    name: stringOrNull(record.name),
    nameSource: stringOrNull(record.nameSource),
    status: registryStatus(status),
    waitingFor: stringOrNull(record.waitingFor),
    statusUpdatedAt: typeof record.statusUpdatedAt === 'number'
      ? record.statusUpdatedAt
      : typeof record.updatedAt === 'number'
        ? record.updatedAt
        : startedAt,
  }
}

function registryStatus(status: string): ClaudeRegistryStatus {
  if (status === 'busy' || status === 'waiting' || status === 'exited' || status === 'stopped') return status
  return 'idle'
}

/** What `ps` reports for a running pid. */
export interface ClaudeProcess {
  readonly command: string | null
  /** C-locale `lstart` in UTC, comparable with the registry's `procStart`. */
  readonly startedAt: string | null
}

export interface ReadRegistryOptions {
  readonly directory: string
  /**
   * Running processes among `pids`; a pid missing from the map is not running.
   * Throwing means identity could not be checked at all. Defaults to one
   * bounded `ps` call; injectable for tests.
   */
  readonly processes?: (pids: readonly number[]) => Promise<ReadonlyMap<number, ClaudeProcess>>
}

export interface ClaudeProcessRejection {
  readonly pid: number
  readonly sessionId: string
  readonly command: string | null
}

export interface ClaudeRegistrySnapshot {
  readonly entries: readonly ClaudeRegistryEntry[]
  /** A live process that is not Claude Code sits behind a registry file that claims it is. */
  readonly processRejections: readonly ClaudeProcessRejection[]
  /** Live registry entries whose process could not be checked, so they are neither shown nor ruled out. */
  readonly unverified: number
}

const LIVE_STATUSES: ReadonlySet<ClaudeRegistryStatus> = new Set(['busy', 'waiting', 'idle'])
/** XNU's `PID_MAX` (bsd/sys/proc_internal.h); `ps -p` answers "process id too large" above it. */
const DARWIN_PID_MAX = 99_999

/**
 * Every interactive Claude Code session whose process is still alive, one per
 * session id. Returns `null` when the registry directory does not exist, so
 * the caller can tell "no sessions" from "no Claude Code here"; any other read
 * failure throws.
 */
export async function readLiveRegistry(
  options: ReadRegistryOptions,
): Promise<ClaudeRegistrySnapshot | null> {
  let names: string[]
  try {
    names = await readdir(options.directory)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
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
    .filter((entry) => LIVE_STATUSES.has(entry.status))
    // `ps` rejects the whole call for one pid it cannot hold, so a file from another process
    // table (or a corrupt one) is skipped here rather than making every session unverifiable.
    .filter((entry) => (entry.pidDomain === null || entry.pidDomain === 'darwin') && entry.pid <= DARWIN_PID_MAX)
  if (candidates.length === 0) return { entries: [], processRejections: [], unverified: 0 }

  let running: ReadonlyMap<number, ClaudeProcess>
  try {
    running = await (options.processes ?? runningProcesses)(candidates.map((entry) => entry.pid))
  } catch {
    return { entries: [], processRejections: [], unverified: candidates.length }
  }

  const verified: ClaudeRegistryEntry[] = []
  const processRejections: ClaudeProcessRejection[] = []
  for (const entry of candidates) {
    const process = running.get(entry.pid)
    // Gone, or the pid now belongs to a process that started after this file was written.
    if (!process || isReusedPid(entry, process)) continue
    if (isClaudeProcess(process.command)) {
      verified.push(entry)
    } else {
      processRejections.push({ pid: entry.pid, sessionId: entry.sessionId, command: process.command })
    }
  }
  return {
    entries: onePerSession(verified).sort((left, right) => right.startedAt - left.startedAt),
    processRejections,
    unverified: 0,
  }
}

/**
 * A resumed session can run in two processes at once (the desktop app and a
 * CLI `--resume`, say). The board shows one card per session: the process
 * that most needs attention, then the newest.
 */
function onePerSession(entries: readonly ClaudeRegistryEntry[]): ClaudeRegistryEntry[] {
  const rank = (entry: ClaudeRegistryEntry) => entry.status === 'waiting' ? 2 : entry.status === 'busy' ? 1 : 0
  const bySession = new Map<string, ClaudeRegistryEntry>()
  for (const entry of entries) {
    const current = bySession.get(entry.sessionId)
    if (
      !current ||
      rank(entry) > rank(current) ||
      (rank(entry) === rank(current) && entry.startedAt > current.startedAt)
    ) {
      bySession.set(entry.sessionId, entry)
    }
  }
  return [...bySession.values()]
}

function isReusedPid(entry: ClaudeRegistryEntry, process: ClaudeProcess): boolean {
  if (!entry.procStart || !process.startedAt) return false
  return normaliseSpaces(entry.procStart) !== normaliseSpaces(process.startedAt)
}

const execFileAsync = promisify(execFile)
const PS_LINE = /^\s*(\d+)\s+(\w{3}\s+\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.+?)\s*$/

/** One `ps` call for every candidate, in the same locale and zone Claude Code records `procStart` in. Exported for tests. */
export async function runningProcesses(pids: readonly number[]): Promise<ReadonlyMap<number, ClaudeProcess>> {
  let stdout: string
  try {
    ;({ stdout } = await execFileAsync('/bin/ps', ['-o', 'pid=,lstart=,comm=', '-p', pids.join(',')], {
      encoding: 'utf8',
      timeout: 2_000,
      env: { PATH: '/usr/bin:/bin', LC_ALL: 'C', TZ: 'UTC' },
    }))
  } catch (error) {
    // `ps` exits 1 silently when none of the pids is running; that is an answer. With a
    // message (an invalid pid, say) it is a failure.
    const failure = error as { code?: unknown; stdout?: unknown; stderr?: unknown; killed?: unknown }
    if (failure.code !== 1 || failure.killed || (typeof failure.stderr === 'string' && failure.stderr.trim())) throw error
    stdout = typeof failure.stdout === 'string' ? failure.stdout : ''
  }
  const processes = new Map<number, ClaudeProcess>()
  for (const line of stdout.split('\n')) {
    const match = line.match(PS_LINE)
    if (match) processes.set(Number(match[1]), { startedAt: match[2]!, command: match[3]! })
  }
  return processes
}

function isClaudeProcess(command: string | null): boolean {
  return command !== null && /^claude(?:$|[-.])/i.test(basename(command))
}

function normaliseSpaces(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}
