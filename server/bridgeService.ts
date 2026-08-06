import { activeSessionCount, deriveStage, launchAvailability } from '../src/domain/stage'
import type { AgentSession, Plan, PlanRevision, PlanStep } from '../src/domain/types'
import type {
  BridgeSnapshot,
  LaunchSessionPayload,
  LaunchSessionResponse,
} from '../src/bridge/types'
import type { AppServerNotification, CodexAppServerClient } from './codex/appServerClient'
import type { CodexStateObserver } from './codex/stateObserver'
import {
  FocusLimitReachedError,
  LaunchCoordinator,
  type LaunchRequest,
} from './domain/focusPolicy'
import type { AgentZenSettingsStore } from './settings'

type BridgeSettings = Pick<
  AgentZenSettingsStore,
  'read' | 'registeredProjects' | 'discoverProjects' | 'setFocus' | 'registerProjects'
>

type BridgeObserver = Pick<CodexStateObserver, 'snapshot'>

type BridgeClient = Pick<
  CodexAppServerClient,
  'connect' | 'request' | 'subscribe' | 'close' | 'isConnected' | 'connectionGeneration'
>

interface SessionOverlay {
  readonly turnId?: string | null
  readonly turnStartedAt?: string | null
  readonly activity?: AgentSession['activity']
  readonly endedAt?: string | null
  readonly plan?: Plan | null
  readonly planHistory?: readonly PlanRevision[]
}

interface ThreadStartResult {
  readonly thread: {
    readonly id: string
    readonly cwd: string
    readonly createdAt: number
    readonly gitInfo?: {
      readonly branch?: string | null
      readonly originUrl?: string | null
    } | null
  }
  readonly model: string
  readonly reasoningEffort?: string | null
}

interface TurnStartResult {
  readonly turn: { readonly id: string; readonly startedAt?: number | null }
}

export interface BridgeServiceDependencies {
  readonly settings: BridgeSettings
  readonly observer: BridgeObserver
  readonly client: BridgeClient
  readonly now?: () => number
}

export class AgentZenBridgeService {
  private readonly overlays = new Map<string, SessionOverlay>()
  private readonly transientSessions = new Map<string, AgentSession>()
  private readonly ownedThreads = new Map<string, number>()
  private readonly launchCoordinator: LaunchCoordinator
  private connection: BridgeSnapshot['connection'] = {
    connected: false,
    label: 'Connecting to Codex…',
    userAgent: null,
    error: null,
  }

  constructor(private readonly dependencies: BridgeServiceDependencies) {
    dependencies.client.subscribe((notification) => this.onNotification(notification))
    this.launchCoordinator = new LaunchCoordinator({
      getSessions: () => this.sessions(),
      getFocus: async () => (await dependencies.settings.read()).focus,
      launch: (request) => this.launchWithCodex(request),
    })
  }

  async start(): Promise<void> {
    try {
      const previousGeneration = this.dependencies.client.connectionGeneration
      const initialized = await this.dependencies.client.connect()
      if (
        previousGeneration > 0 &&
        this.dependencies.client.connectionGeneration !== previousGeneration
      ) {
        this.ownedThreads.clear()
        this.overlays.clear()
        this.transientSessions.clear()
      }
      const userAgent = typeof initialized.userAgent === 'string' ? initialized.userAgent : 'Codex app-server'
      this.connection = {
        connected: true,
        label: 'Live Codex · app-server control + local observer',
        userAgent,
        error: null,
      }
    } catch (error) {
      this.connection = {
        connected: false,
        label: 'Codex connection unavailable',
        userAgent: null,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async snapshot(): Promise<BridgeSnapshot> {
    if (!this.dependencies.client.isConnected) await this.start()
    const [settings, projects, projectCandidates, sessions] = await Promise.all([
      this.dependencies.settings.read(),
      this.dependencies.settings.registeredProjects(),
      this.dependencies.settings.discoverProjects(),
      this.sessions(),
    ])
    const activeCount = activeSessionCount(sessions, deriveStage)
    return {
      generatedAt: new Date(this.now()).toISOString(),
      connection: this.connection,
      sessions,
      focus: {
        ...settings.focus,
        activeCount,
        availability: launchAvailability(activeCount, settings.focus.enabled, settings.focus.limit),
      },
      projects,
      projectCandidates,
    }
  }

  health(): Pick<BridgeSnapshot, 'connection' | 'generatedAt'> {
    return {
      connection: this.connection,
      generatedAt: new Date(this.now()).toISOString(),
    }
  }

  async setFocus(enabled: boolean, limit: number): Promise<BridgeSnapshot> {
    await this.dependencies.settings.setFocus({ enabled, limit })
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

  async interrupt(threadId: string): Promise<void> {
    const session = await this.controllableSession(threadId)
    if (!session.turnId) throw new Error('This session has no active turn to interrupt.')
    await this.dependencies.client.request('turn/interrupt', {
      threadId,
      turnId: session.turnId,
    })
  }

  async steer(threadId: string, prompt: string): Promise<void> {
    const session = await this.controllableSession(threadId)
    if (!session.turnId) throw new Error('This session has no active turn to steer.')
    const text = prompt.trim()
    if (!text) throw new Error('A steering message is required.')
    await this.dependencies.client.request('turn/steer', {
      threadId,
      expectedTurnId: session.turnId,
      input: [{ type: 'text', text, text_elements: [] }],
    })
  }

  close(): Promise<void> {
    return this.dependencies.client.close()
  }

  private async sessions(): Promise<AgentSession[]> {
    const observed = await this.dependencies.observer.snapshot()
    const ids = new Set(observed.map((session) => session.id))
    const merged = observed.map((session) => this.withRuntimeOwnership(this.mergeOverlay(session)))
    for (const transient of this.transientSessions.values()) {
      if (!ids.has(transient.id)) merged.push(this.withRuntimeOwnership(this.mergeOverlay(transient)))
    }
    return merged
      .filter((session) => session.endedAt === null)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  }

  private async launchWithCodex(request: LaunchRequest): Promise<LaunchSessionResponse> {
    if (!this.connection.connected) {
      await this.start()
      if (!this.connection.connected) throw new Error(this.connection.error ?? 'Codex is unavailable.')
    }
    let threadId: string | null = null
    try {
      const thread = await this.dependencies.client.request<ThreadStartResult>('thread/start', {
        cwd: request.cwd,
        model: request.model ?? undefined,
      })
      threadId = thread.thread.id
      const startedAt = new Date(this.now()).toISOString()
      const turn = await this.dependencies.client.request<TurnStartResult>('turn/start', {
        threadId,
        input: [{ type: 'text', text: request.prompt, text_elements: [] }],
        model: request.model ?? undefined,
        effort: request.effort ?? undefined,
      })
      this.ownedThreads.set(threadId, this.dependencies.client.connectionGeneration)
      this.transientSessions.set(threadId, transientSession(thread, request, startedAt))
      const previous = this.overlays.get(threadId) ?? {}
      this.overlays.set(threadId, {
        ...previous,
        turnId: turn.turn.id,
        turnStartedAt: turn.turn.startedAt
          ? new Date(turn.turn.startedAt * 1000).toISOString()
          : startedAt,
        activity: 'working',
        endedAt: null,
      })
      return { threadId, turnId: turn.turn.id }
    } catch (error) {
      if (threadId) {
        this.ownedThreads.delete(threadId)
        this.transientSessions.delete(threadId)
        this.overlays.delete(threadId)
      }
      throw error
    }
  }

  private async controllableSession(threadId: string): Promise<AgentSession> {
    if (!this.ownsThreadInCurrentConnection(threadId)) {
      throw new Error('This session is visible but controlled by another Codex process.')
    }
    const session = (await this.sessions()).find((candidate) => candidate.id === threadId)
    if (!session) throw new Error('Session not found.')
    return session
  }

  private onNotification(notification: AppServerNotification): void {
    if (!notification.params || typeof notification.params !== 'object') return
    const params = notification.params as Record<string, unknown>
    const threadId = typeof params.threadId === 'string' ? params.threadId : null
    if (!threadId) return
    const previous = this.overlays.get(threadId) ?? {}

    if (notification.method === 'turn/started' && isObject(params.turn)) {
      const turn = params.turn
      this.overlays.set(threadId, {
        ...previous,
        turnId: stringValue(turn.id),
        turnStartedAt:
          typeof turn.startedAt === 'number'
            ? new Date(turn.startedAt * 1000).toISOString()
            : new Date(this.now()).toISOString(),
        activity: 'working',
        endedAt: null,
        plan: null,
        planHistory: [],
      })
      return
    }
    if (notification.method === 'turn/plan/updated' && Array.isArray(params.plan)) {
      const current = previous.plan ?? null
      const steps: PlanStep[] = params.plan.flatMap((entry): PlanStep[] => {
        if (!isObject(entry) || typeof entry.step !== 'string' || typeof entry.status !== 'string') return []
        const status = entry.status === 'inProgress' ? 'in_progress' : entry.status
        if (status !== 'pending' && status !== 'in_progress' && status !== 'completed') return []
        return [{ step: entry.step, status }]
      })
      const plan: Plan = {
        revision: (current?.revision ?? 0) + 1,
        updatedAt: new Date(this.now()).toISOString(),
        explanation: typeof params.explanation === 'string' ? params.explanation : null,
        steps,
      }
      this.overlays.set(threadId, {
        ...previous,
        plan,
        planHistory: current ? [...(previous.planHistory ?? []), current] : previous.planHistory ?? [],
      })
      return
    }
    if (notification.method === 'turn/completed') {
      this.overlays.set(threadId, {
        ...previous,
        activity: 'ended',
        endedAt: new Date(this.now()).toISOString(),
      })
    }
  }

  private mergeOverlay(session: AgentSession): AgentSession {
    const overlay = this.overlays.get(session.id)
    return overlay ? { ...session, ...overlay } : session
  }

  private withRuntimeOwnership(session: AgentSession): AgentSession {
    return {
      ...session,
      source: this.ownsThreadInCurrentConnection(session.id) ? 'owned' : 'external',
    }
  }

  private ownsThreadInCurrentConnection(threadId: string): boolean {
    return this.dependencies.client.isConnected &&
      this.ownedThreads.get(threadId) === this.dependencies.client.connectionGeneration
  }

  private now(): number {
    return this.dependencies.now?.() ?? Date.now()
  }
}

function transientSession(
  result: ThreadStartResult,
  request: LaunchRequest,
  startedAt: string,
): AgentSession {
  return {
    id: result.thread.id,
    threadId: result.thread.id,
    turnId: null,
    title: request.prompt.length > 84 ? `${request.prompt.slice(0, 81).trimEnd()}…` : request.prompt,
    agent: 'codex',
    source: 'owned',
    model: result.model,
    reasoningEffort: result.reasoningEffort ?? request.effort ?? null,
    cliVersion: null,
    createdAt: result.thread.createdAt
      ? new Date(result.thread.createdAt * 1000).toISOString()
      : startedAt,
    turnStartedAt: startedAt,
    activity: 'working',
    parentSessionId: null,
    cwd: result.thread.cwd,
    repository: null,
    branch: result.thread.gitInfo?.branch ?? null,
    worktree: result.thread.cwd,
    projectId: null,
    plan: null,
    planHistory: [],
    review: null,
    wrapup: null,
    endedAt: null,
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

export { FocusLimitReachedError }
