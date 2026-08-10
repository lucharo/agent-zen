import { activeSessionCount, deriveStage, launchAvailability } from '../src/domain/stage'
import type {
  AgentSession,
  PendingSessionRequest,
  Plan,
  PlanRevision,
  PlanStep,
  SessionApprovalDecision,
} from '../src/domain/types'
import type {
  BridgeSnapshot,
  LaunchSessionPayload,
  LaunchSessionResponse,
  SessionRequestResponse,
} from '../src/bridge/types'
import { BRIDGE_PROTOCOL_VERSION } from '../src/bridge/types'
import type { UiPreferences } from '../src/domain/preferences'
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
  'read' | 'registeredProjects' | 'discoverProjects' | 'setFocus' | 'setPreferences' | 'registerProjects'
>

type BridgeObserver = Pick<CodexStateObserver, 'snapshot'>

type BridgeClient = Pick<
  CodexAppServerClient,
  'connect' | 'request' | 'respond' | 'subscribe' | 'close' | 'isConnected' | 'connectionGeneration'
>

interface SessionOverlay {
  readonly turnId?: string | null
  readonly turnStartedAt?: string | null
  readonly activity?: AgentSession['activity']
  readonly hasSubstantiveActivity?: boolean
  readonly endedAt?: string | null
  readonly plan?: Plan | null
  readonly planHistory?: readonly PlanRevision[]
  readonly pendingRequest?: PendingSessionRequest | null
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

interface ThreadReadResult {
  readonly thread?: {
    readonly id?: string
    readonly name?: string | null
  }
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
    const activeCount = activeSessionCount(sessions, deriveStage)
    return {
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      generatedAt: new Date(this.now()).toISOString(),
      connection: this.connection,
      sessions,
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

  async respond(threadId: string, response: SessionRequestResponse): Promise<void> {
    await this.controllableSession(threadId)
    const previous = this.overlays.get(threadId) ?? {}
    const pending = previous.pendingRequest
    if (!pending || pending.requestId !== response.requestId) {
      throw new Error('This Codex request is no longer pending.')
    }
    await this.dependencies.client.respond(response.requestId, nativeResponse(pending, response))
    this.overlays.set(threadId, {
      ...previous,
      activity: 'working',
      pendingRequest: null,
    })
  }

  close(): Promise<void> {
    return this.dependencies.client.close()
  }

  private async sessions(): Promise<AgentSession[]> {
    const observed = await this.dependencies.observer.snapshot()
    const catalogNames = await this.catalogNames(observed.map((session) => session.id))
    const ids = new Set(observed.map((session) => session.id))
    for (const id of ids) this.transientSessions.delete(id)
    const merged = observed.map((session) => this.withRuntimeOwnership(this.mergeOverlay({
      ...session,
      title: catalogNames.get(session.id) ?? session.title,
    })))
    for (const transient of this.transientSessions.values()) {
      if (!ids.has(transient.id)) merged.push(this.withRuntimeOwnership(this.mergeOverlay(transient)))
    }
    return merged
      .filter((session) => session.endedAt === null)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  }

  private async catalogNames(threadIds: readonly string[]): Promise<ReadonlyMap<string, string>> {
    const entries = await Promise.all(threadIds.map(async (threadId): Promise<[string, string] | null> => {
      try {
        const result = await this.dependencies.client.request<ThreadReadResult>('thread/read', {
          threadId,
          includeTurns: false,
        })
        const name = typeof result.thread?.name === 'string'
          ? compactTitle(result.thread.name)
          : ''
        return name ? [threadId, name] : null
      } catch {
        // One unreadable catalog entry must not hide the rest of the live board.
        return null
      }
    }))
    return new Map(entries.filter((entry): entry is [string, string] => entry !== null))
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
        hasSubstantiveActivity: false,
        endedAt: null,
      })
      return { threadId, turnId: turn.turn.id }
    } catch (error) {
      if (threadId) {
        await this.dependencies.client.request('thread/archive', { threadId }).catch(() => undefined)
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
    const threadId = typeof params.threadId === 'string'
      ? params.threadId
      : typeof params.conversationId === 'string'
        ? params.conversationId
        : null
    if (!threadId) return
    // The bundled app-server may report lifecycle events for threads created by
    // another Codex process. Those threads belong to the read-only observer;
    // applying a runtime overlay here can hide a newer external turn behind a
    // stale completion event.
    if (!this.ownsThreadInCurrentConnection(threadId)) return
    const previous = this.overlays.get(threadId) ?? {}

    const pendingRequest = pendingSessionRequest(notification)
    if (pendingRequest) {
      this.overlays.set(threadId, {
        ...previous,
        activity: 'awaiting-input',
        hasSubstantiveActivity: true,
        pendingRequest,
      })
      return
    }
    if (notification.method === 'serverRequest/resolved') {
      const requestId = params.requestId
      if (previous.pendingRequest && previous.pendingRequest.requestId === requestId) {
        this.overlays.set(threadId, {
          ...previous,
          activity: 'working',
          pendingRequest: null,
        })
      }
      return
    }
    if (notification.method === 'item/started' && isObject(params.item)) {
      if (isSubstantiveItem(params.item.type)) {
        this.overlays.set(threadId, {
          ...previous,
          hasSubstantiveActivity: true,
        })
      }
      return
    }

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
        hasSubstantiveActivity: false,
        endedAt: null,
        plan: null,
        planHistory: [],
        pendingRequest: null,
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
        hasSubstantiveActivity: true,
        planHistory: current ? [...(previous.planHistory ?? []), current] : previous.planHistory ?? [],
      })
      return
    }
    if (notification.method === 'turn/completed') {
      const completedTurnId = isObject(params.turn) ? stringValue(params.turn.id) : null
      if (previous.turnId && completedTurnId && previous.turnId !== completedTurnId) return
      this.overlays.set(threadId, {
        ...previous,
        activity: 'idle',
        endedAt: null,
        pendingRequest: null,
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
    hasSubstantiveActivity: false,
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

function isBlockingUserRequest(notification: AppServerNotification): boolean {
  if (!notification.method.endsWith('/requestApproval') &&
    notification.method !== 'item/tool/requestUserInput' &&
    notification.method !== 'mcpServer/elicitation/request' &&
    notification.method !== 'execCommandApproval' &&
    notification.method !== 'applyPatchApproval') {
    return false
  }
  if (!notification.params || typeof notification.params !== 'object') return true
  const params = notification.params as Record<string, unknown>
  return params.isBlocking !== false
}

function pendingSessionRequest(notification: AppServerNotification): PendingSessionRequest | null {
  if (notification.id === undefined || !isBlockingUserRequest(notification)) return null
  const params = isObject(notification.params) ? notification.params : {}
  if (notification.method === 'item/tool/requestUserInput') {
    const questions = Array.isArray(params.questions)
      ? params.questions.flatMap((entry) => {
          if (!isObject(entry) || typeof entry.id !== 'string' || typeof entry.question !== 'string') {
            return []
          }
          const options = Array.isArray(entry.options)
            ? entry.options.flatMap((option) => (
                isObject(option) && typeof option.label === 'string'
                  ? [{
                      label: option.label,
                      description: typeof option.description === 'string' ? option.description : '',
                    }]
                  : []
              ))
            : null
          return [{
            id: entry.id,
            header: typeof entry.header === 'string' ? entry.header : 'Question',
            question: entry.question,
            isOther: entry.isOther === true,
            isSecret: entry.isSecret === true,
            options,
          }]
        })
      : []
    return { kind: 'user-input', requestId: notification.id, questions }
  }
  if (notification.method === 'item/commandExecution/requestApproval') {
    return {
      kind: 'approval',
      requestId: notification.id,
      approval: 'command',
      title: 'Approve command?',
      detail: typeof params.command === 'string' ? params.command : null,
      reason: typeof params.reason === 'string' ? params.reason : null,
      availableDecisions: approvalDecisions(params.availableDecisions),
    }
  }
  if (notification.method === 'item/fileChange/requestApproval') {
    return {
      kind: 'approval',
      requestId: notification.id,
      approval: 'file',
      title: 'Approve file changes?',
      detail: typeof params.grantRoot === 'string' ? params.grantRoot : null,
      reason: typeof params.reason === 'string' ? params.reason : null,
      availableDecisions: BASIC_APPROVAL_DECISIONS,
    }
  }
  if (notification.method === 'item/permissions/requestApproval') {
    return {
      kind: 'permissions',
      requestId: notification.id,
      title: 'Grant additional permissions?',
      reason: typeof params.reason === 'string' ? params.reason : null,
      requestedPermissions: isObject(params.permissions) ? params.permissions : {},
    }
  }
  if (notification.method === 'execCommandApproval') {
    const command = Array.isArray(params.command)
      ? params.command.filter((part): part is string => typeof part === 'string').join(' ')
      : null
    return {
      kind: 'approval',
      requestId: notification.id,
      approval: 'legacy-command',
      title: 'Approve command?',
      detail: command,
      reason: typeof params.reason === 'string' ? params.reason : null,
      availableDecisions: BASIC_APPROVAL_DECISIONS,
    }
  }
  if (notification.method === 'applyPatchApproval') {
    return {
      kind: 'approval',
      requestId: notification.id,
      approval: 'legacy-file',
      title: 'Approve file changes?',
      detail: typeof params.grantRoot === 'string' ? params.grantRoot : null,
      reason: typeof params.reason === 'string' ? params.reason : null,
      availableDecisions: BASIC_APPROVAL_DECISIONS,
    }
  }
  return {
    kind: 'unsupported',
    requestId: notification.id,
    title: 'Codex needs input in its native client',
    detail: notification.method,
  }
}

const BASIC_APPROVAL_DECISIONS: readonly SessionApprovalDecision[] = [
  'accept',
  'acceptForSession',
  'decline',
  'cancel',
]

function approvalDecisions(value: unknown): readonly SessionApprovalDecision[] {
  if (!Array.isArray(value)) return BASIC_APPROVAL_DECISIONS
  const decisions = value.filter((entry): entry is SessionApprovalDecision => (
    entry === 'accept' || entry === 'acceptForSession' || entry === 'decline' || entry === 'cancel'
  ))
  return decisions.length > 0 ? decisions : BASIC_APPROVAL_DECISIONS
}

function nativeResponse(
  pending: PendingSessionRequest,
  response: SessionRequestResponse,
): unknown {
  if (pending.kind === 'user-input' && response.kind === 'user-input') {
    return {
      answers: Object.fromEntries(
        Object.entries(response.answers).map(([id, answers]) => [id, { answers: [...answers] }]),
      ),
    }
  }
  if (pending.kind === 'approval' && response.kind === 'approval') {
    if (!pending.availableDecisions.includes(response.decision)) {
      throw new Error('That approval decision is not available for this request.')
    }
    if (pending.approval === 'legacy-command' || pending.approval === 'legacy-file') {
      return { decision: legacyApprovalDecision(response.decision) }
    }
    return { decision: response.decision }
  }
  if (pending.kind === 'permissions' && response.kind === 'permissions') {
    return {
      permissions: grantedPermissionProfile(pending.requestedPermissions),
      scope: response.scope,
    }
  }
  throw new Error('The response does not match the pending Codex request.')
}

function grantedPermissionProfile(
  requested: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    ['network', 'fileSystem'].flatMap((key) => requested[key] == null ? [] : [[key, requested[key]]]),
  )
}

function legacyApprovalDecision(decision: SessionApprovalDecision): unknown {
  if (decision === 'accept') return 'approved'
  if (decision === 'acceptForSession') return 'approved_for_session'
  if (decision === 'decline') return { denied: { rejection: 'Declined in Agent Zen.' } }
  return 'abort'
}

function isSubstantiveItem(type: unknown): boolean {
  return type === 'agentMessage' ||
    type === 'commandExecution' ||
    type === 'fileChange' ||
    type === 'mcpToolCall' ||
    type === 'dynamicToolCall' ||
    type === 'collabAgentToolCall' ||
    type === 'webSearch' ||
    type === 'imageView' ||
    type === 'imageGeneration'
}

function compactTitle(value: string): string {
  const singleLine = value.trim().replace(/\s+/g, ' ')
  return singleLine.length > 84 ? `${singleLine.slice(0, 81).trimEnd()}…` : singleLine
}

export { FocusLimitReachedError }
