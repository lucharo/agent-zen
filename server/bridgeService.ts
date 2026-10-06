import {
  activeSessionCount,
  classifyAgentSessions,
  launchAvailability,
} from '../src/domain/stage'
import { AGENT_LABELS, type AgentKind, type AgentSession } from '../src/domain/types'
import type {
  BridgeConnectionStatus,
  BridgeSnapshot,
  LaunchSessionPayload,
  LaunchSessionResponse,
  SessionRequestResponse,
} from '../src/bridge/types'
import { BRIDGE_PROTOCOL_VERSION } from '../src/bridge/types'
import type { UiPreferences } from '../src/domain/preferences'
import type { AgentBackend, BackendStatus, SessionController } from './backends/types'
import { CodexBackend, type CodexClient, type CodexObserver } from './codex/codexBackend'
import { FocusLimitReachedError, LaunchCoordinator } from './domain/focusPolicy'
import type { AgentZenSettingsStore } from './settings'

type BridgeSettings = Pick<
  AgentZenSettingsStore,
  'read' | 'registeredProjects' | 'discoverProjects' | 'setFocus' | 'setPreferences' | 'registerProjects'
>

export interface BridgeServiceDependencies {
  readonly settings: BridgeSettings
  readonly now?: () => number
  /** Every agent the bridge should merge. Defaults to one Codex backend built from `client` + `observer`. */
  readonly backends?: readonly AgentBackend[]
  readonly observer?: CodexObserver
  readonly client?: CodexClient
}

/**
 * The agent-agnostic bridge. It merges every backend's sessions into one board,
 * classifies them once, and routes the few supported control calls to the
 * backend that owns the session.
 */
export class AgentZenBridgeService {
  private readonly backends: readonly AgentBackend[]
  private readonly backendFailures = new Map<AgentKind, string>()
  /** Each backend's last successful observation, kept on the board while that backend is failing. */
  private readonly lastObserved = new Map<AgentKind, AgentSession[]>()
  /** Agents that have connected at least once, so losing one is an alert and never having one is not. */
  private readonly everConnected = new Set<AgentKind>()
  private readonly launchCoordinator: LaunchCoordinator

  constructor(private readonly dependencies: BridgeServiceDependencies) {
    this.backends = dependencies.backends ?? [defaultCodexBackend(dependencies)]
    this.launchCoordinator = new LaunchCoordinator({
      getSessions: () => this.sessions(true),
      getFocus: async () => (await dependencies.settings.read()).focus,
      launch: (request) => this.launchController().launch(request),
    })
  }

  async start(): Promise<void> {
    await Promise.all(this.backends.map(async (backend) => {
      try {
        await backend.start()
        this.backendFailures.delete(backend.agent)
      } catch (error) {
        this.backendFailures.set(backend.agent, errorMessage(error))
      }
    }))
  }

  async snapshot(): Promise<BridgeSnapshot> {
    const [settings, projectCandidates, sessions] = await Promise.all([
      this.dependencies.settings.read(),
      this.dependencies.settings.discoverProjects(),
      this.sessions(),
    ])
    let projects = await this.dependencies.settings.registeredProjects()
    const registeredIds = new Set(projects.map((project) => project.id))
    const activeProjectIds = new Set(
      sessions.flatMap((session) => (session.projectId ? [session.projectId] : [])),
    )
    const newlyObservedIds = projectCandidates
      .filter((candidate) => activeProjectIds.has(candidate.id) && !registeredIds.has(candidate.id))
      .map((candidate) => candidate.id)
    if (newlyObservedIds.length > 0) {
      projects = await this.dependencies.settings.registerProjects(newlyObservedIds)
    }
    const classifiedSessions = classifyAgentSessions(sessions)
    const activeCount = activeSessionCount(
      classifiedSessions,
      (session) => session.classification.stage,
    )
    const backends = this.backendStatuses()
    return {
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      generatedAt: new Date(this.now()).toISOString(),
      connection: aggregateConnection(backends, this.everConnected),
      backends,
      sessions: classifiedSessions,
      focus: {
        ...settings.focus,
        activeCount,
        availability: launchAvailability(activeCount, settings.focus.enabled, settings.focus.limit),
      },
      preferences: settings.preferences,
      projects,
      projectCandidates,
    }
  }

  health(): Pick<BridgeSnapshot, 'protocolVersion' | 'connection' | 'backends' | 'generatedAt'> {
    const backends = this.backendStatuses()
    return {
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      connection: aggregateConnection(backends, this.everConnected),
      backends,
      generatedAt: new Date(this.now()).toISOString(),
    }
  }

  async setFocus(enabled: boolean, limit: number): Promise<BridgeSnapshot> {
    await this.dependencies.settings.setFocus({ enabled, limit })
    return this.snapshot()
  }

  async setPreferences(preferences: UiPreferences): Promise<BridgeSnapshot> {
    await this.dependencies.settings.setPreferences(preferences)
    return this.snapshot()
  }

  async registerProjects(candidateIds: readonly string[]): Promise<BridgeSnapshot> {
    await this.dependencies.settings.registerProjects(candidateIds)
    return this.snapshot()
  }

  async launch(payload: LaunchSessionPayload): Promise<LaunchSessionResponse> {
    const projects = await this.dependencies.settings.registeredProjects()
    const project = projects.find((candidate) => candidate.id === payload.projectId)
    if (!project) throw new Error('Choose a registered project before launching a session.')
    const prompt = payload.prompt.trim()
    if (!prompt) throw new Error('A launch prompt is required.')
    return this.launchCoordinator.launch({
      cwd: project.directory,
      prompt,
      model: payload.model,
      effort: payload.effort,
    })
  }

  async interrupt(sessionId: string): Promise<void> {
    const controller = await this.controllerFor(sessionId)
    await controller.interrupt(sessionId)
  }

  async steer(sessionId: string, prompt: string): Promise<void> {
    const controller = await this.controllerFor(sessionId)
    await controller.steer(sessionId, prompt)
  }

  async respond(sessionId: string, response: SessionRequestResponse): Promise<void> {
    const controller = await this.controllerFor(sessionId)
    await controller.respond(sessionId, response)
  }

  async close(): Promise<void> {
    // Every backend gets to close even when another one fails to.
    const results = await Promise.allSettled(this.backends.map((backend) => backend.close()))
    const failure = results.find((result) => result.status === 'rejected')
    if (failure) throw failure.reason
  }

  private async sessions(failClosed = false): Promise<AgentSession[]> {
    const observed = await Promise.all(this.backends.map(async (backend) => {
      try {
        const sessions = await backend.observe()
        this.backendFailures.delete(backend.agent)
        this.lastObserved.set(backend.agent, sessions)
        return sessions
      } catch (error) {
        const message = errorMessage(error)
        this.backendFailures.set(backend.agent, message)
        if (failClosed) {
          throw new Error(`Could not verify active ${AGENT_LABELS[backend.agent]} sessions: ${message}`)
        }
        // A failed poll is not proof the work stopped: keep what was last seen, with the failure beside it.
        return this.lastObserved.get(backend.agent) ?? []
      }
    }))
    return observed
      .flat()
      .filter((session) => session.endedAt === null)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  }

  private backendStatuses(): BackendStatus[] {
    const statuses = this.backends.map((backend): BackendStatus => {
      const failure = this.backendFailures.get(backend.agent)
      if (!failure) return backend.status()
      return {
        agent: backend.agent,
        connected: false,
        label: `${AGENT_LABELS[backend.agent]} unavailable`,
        userAgent: null,
        error: failure,
      }
    })
    for (const status of statuses) if (status.connected) this.everConnected.add(status.agent)
    return statuses
  }

  /** Launches are Codex-only: it is the one agent with a supported launch surface. */
  private launchController(): SessionController {
    const controller = this.backendFor('codex')?.controller
    if (!controller) throw new Error('Codex is not available to launch a session.')
    return controller
  }

  /**
   * Only read-only backends are observed here: a session one of them owns is
   * refused, and anything else goes to Codex, whose controller checks its own
   * ownership before it observes, so a control call never observes Codex twice.
   */
  private async controllerFor(sessionId: string): Promise<SessionController> {
    for (const backend of this.backends) {
      if (backend.controller) continue
      const sessions = await backend.observe().catch(() => this.lastObserved.get(backend.agent) ?? [])
      if (sessions.some((session) => session.id === sessionId)) throw new ReadOnlySessionError()
    }
    const controller = this.backendFor('codex')?.controller
    if (!controller) throw new Error('Session not found.')
    return controller
  }

  private backendFor(agent: AgentKind): AgentBackend | null {
    return this.backends.find((backend) => backend.agent === agent) ?? null
  }

  private now(): number {
    return this.dependencies.now?.() ?? Date.now()
  }
}

/** A control call for a session Agent Zen only observes. */
export class ReadOnlySessionError extends Error {
  constructor() {
    super('This session is read-only in Agent Zen.')
    this.name = 'ReadOnlySessionError'
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function defaultCodexBackend(dependencies: BridgeServiceDependencies): AgentBackend {
  if (!dependencies.client || !dependencies.observer) {
    throw new Error('AgentZenBridgeService needs either backends or a Codex client and observer.')
  }
  return new CodexBackend({
    client: dependencies.client,
    observer: dependencies.observer,
    now: dependencies.now,
  })
}

/**
 * One status line for surfaces that predate multiple agents. Connected when any
 * backend is; the Codex line leads because it is the only controllable one.
 */
export function aggregateConnection(
  backends: readonly BackendStatus[],
  everConnected: ReadonlySet<AgentKind> = new Set(),
): BridgeConnectionStatus {
  const connected = backends.filter((backend) => backend.connected)
  if (connected.length === 0) {
    const lead = backends.find((backend) => backend.agent === 'codex') ?? backends[0]
    const reported = lead?.error ? lead : backends.find((backend) => backend.error) ?? lead
    return {
      connected: false,
      label: reported?.label ?? 'No agent connections',
      userAgent: null,
      error: reported?.error ?? null,
    }
  }
  const userAgents = connected.flatMap((backend) => (backend.userAgent ? [backend.userAgent] : []))
  // Codex is the only agent that can launch, so losing it still raises the global alert while
  // Claude is up; a Mac that never had Codex stays quiet. Other backends' problems stay in
  // their own Settings row.
  const codex = backends.find((backend) => backend.agent === 'codex')
  const codexLost = codex && !codex.connected && everConnected.has('codex')
  return {
    connected: true,
    label: connected.map((backend) => backend.label).join(' / '),
    userAgent: userAgents.length > 0 ? userAgents.join(' / ') : null,
    error: codexLost ? codex.error ?? `${codex.label}.` : null,
  }
}

export { FocusLimitReachedError }
