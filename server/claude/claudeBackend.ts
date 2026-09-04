import { join } from 'node:path'
import type { AgentSession, Project } from '../../src/domain/types'
import type { AgentBackend, BackendStatus } from '../backends/types'
import { normaliseGitHubRepository, gitOriginUrl as readGitOriginUrl } from '../projects'
import { compactTitle, resolveProject } from '../shared/projects'
import { readLiveRegistry, type ClaudeRegistryEntry } from './registry'
import { readTaskPlan } from './tasks'
import { ClaudeTranscriptReader, type ClaudeTranscriptSnapshot } from './transcript'

export interface ClaudeBackendOptions {
  /** The Claude Code home, normally `~/.claude`. */
  readonly claudeHome: string
  readonly getProjects: () => readonly Project[] | Promise<readonly Project[]>
  readonly isProcessAlive?: (pid: number) => boolean
  readonly gitOriginUrl?: (directory: string) => Promise<string | null>
  readonly now?: () => number
}

/**
 * Claude Code as a read-only agent backend.
 *
 * Nothing about Claude Code is configured or wrapped: the stock binary writes
 * a per-process registry, an append-only transcript and a task list, and this
 * backend only reads them. There is no controller; every Claude session stays
 * `external`.
 */
export class ClaudeBackend implements AgentBackend {
  readonly agent = 'claude' as const
  readonly controller = null
  private readonly transcripts = new ClaudeTranscriptReader()
  private readonly transcriptPaths = new Map<string, string>()
  private readonly origins = new Map<string, Promise<string | null>>()
  private connection: BackendStatus = {
    agent: 'claude',
    connected: false,
    label: 'Looking for Claude Code…',
    userAgent: null,
    error: null,
  }

  constructor(private readonly options: ClaudeBackendOptions) {}

  async start(): Promise<void> {
    await this.observe()
  }

  status(): BackendStatus {
    return this.connection
  }

  async observe(): Promise<AgentSession[]> {
    const [entries, projects] = await Promise.all([
      readLiveRegistry({
        directory: join(this.options.claudeHome, 'sessions'),
        isProcessAlive: this.options.isProcessAlive,
      }),
      this.options.getProjects(),
    ])
    if (entries === null) {
      this.connection = {
        agent: 'claude',
        connected: false,
        label: 'Claude Code not found',
        userAgent: null,
        error: `No Claude Code session registry at ${join(this.options.claudeHome, 'sessions')}.`,
      }
      return []
    }
    const version = entries.find((entry) => entry.version)?.version ?? null
    this.connection = {
      agent: 'claude',
      connected: true,
      label: 'Claude Code · local observer',
      userAgent: version ? `Claude Code ${version}` : 'Claude Code',
      error: null,
    }
    const sessions: AgentSession[] = []
    for (const entry of entries) sessions.push(await this.toSession(entry, projects))
    return sessions
  }

  async close(): Promise<void> {}

  private async toSession(entry: ClaudeRegistryEntry, projects: readonly Project[]): Promise<AgentSession> {
    const transcriptPath = await this.transcriptPath(entry.sessionId)
    const [transcript, plan, origin] = await Promise.all([
      transcriptPath ? this.transcripts.read(transcriptPath) : null,
      this.taskPlan(entry.sessionId),
      this.origin(entry.cwd),
    ])
    const repository = normaliseGitHubRepository(origin)
    const project = resolveProject(projects, entry.cwd, repository)
    const activity = entry.status === 'busy'
      ? 'working'
      : entry.status === 'waiting'
        ? 'awaiting-input'
        : 'idle'
    const hasSubstantiveActivity = transcript?.hasSubstantiveActivity ?? entry.status === 'busy'
    const stageHint = transcript?.stageHint ?? null

    return {
      id: entry.sessionId,
      threadId: entry.sessionId,
      turnId: transcript?.turnId ?? null,
      title: sessionTitle(entry, transcript),
      agent: 'claude',
      source: 'external',
      model: transcript?.model ?? 'claude',
      reasoningEffort: null,
      cliVersion: entry.version ?? transcript?.cliVersion ?? null,
      createdAt: new Date(entry.startedAt).toISOString(),
      turnStartedAt: transcript?.turnStartedAt
        ?? (activity === 'working' ? new Date(entry.statusUpdatedAt).toISOString() : null),
      activity,
      collaborationMode: transcript?.collaborationMode ?? 'default',
      turnOutcome: activity === 'idle' && hasSubstantiveActivity ? 'completed' : null,
      hasSubstantiveActivity,
      parentSessionId: null,
      cwd: entry.cwd,
      repository,
      branch: transcript?.branch ?? null,
      worktree: entry.cwd,
      projectId: project?.id ?? null,
      plan,
      planHistory: [],
      goal: null,
      review: stageHint === 'reviewing'
        ? { visualChecked: null, prReady: null, openNotes: null, pullRequest: null }
        : null,
      wrapup: stageHint === 'wrapping-up' ? { checksPassed: null, checksTotal: null } : null,
      pendingRequest: activity === 'awaiting-input'
        ? {
            kind: 'unsupported',
            requestId: entry.statusUpdatedAt,
            title: 'Claude Code needs you in its terminal',
            detail: entry.waitingFor,
          }
        : null,
      endedAt: null,
    }
  }

  /** Claude Code has keyed its task directory by full session id and, more recently, by `session-<8 hex>`. */
  private async taskPlan(sessionId: string) {
    const root = join(this.options.claudeHome, 'tasks')
    return (await readTaskPlan(join(root, sessionId)))
      ?? readTaskPlan(join(root, `session-${sessionId.slice(0, 8)}`))
  }

  /** The transcript lives under the slug of the session's *starting* cwd, so find it by id once. */
  private async transcriptPath(sessionId: string): Promise<string | null> {
    const cached = this.transcriptPaths.get(sessionId)
    if (cached) return cached
    const projectsDirectory = join(this.options.claudeHome, 'projects')
    const glob = new Bun.Glob(`*/${sessionId}.jsonl`)
    try {
      for await (const match of glob.scan({ cwd: projectsDirectory, onlyFiles: true })) {
        const path = join(projectsDirectory, match)
        this.transcriptPaths.set(sessionId, path)
        return path
      }
    } catch {
      return null
    }
    return null
  }

  private origin(cwd: string): Promise<string | null> {
    const cached = this.origins.get(cwd)
    if (cached) return cached
    const lookup = (this.options.gitOriginUrl ?? readGitOriginUrl)(cwd).catch(() => null)
    this.origins.set(cwd, lookup)
    return lookup
  }
}

function sessionTitle(entry: ClaudeRegistryEntry, transcript: ClaudeTranscriptSnapshot | null): string {
  const raw = transcript?.customTitle
    ?? transcript?.aiTitle
    ?? transcript?.firstPrompt
    ?? entry.name
    ?? 'Untitled Claude Code session'
  return compactTitle(raw) || 'Untitled Claude Code session'
}
