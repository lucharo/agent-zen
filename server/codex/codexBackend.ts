import type {
  AgentSession,
  PendingSessionRequest,
  Plan,
  PlanRevision,
  PlanStep,
  SessionApprovalDecision,
} from '../../src/domain/types'
import type { LaunchSessionResponse, SessionRequestResponse } from '../../src/bridge/types'
import type { AgentBackend, BackendStatus, SessionController } from '../backends/types'
import type { LaunchRequest } from '../domain/focusPolicy'
import { compactTitle } from '../shared/projects'
import type { AppServerNotification, CodexAppServerClient } from './appServerClient'
import type { CodexStateObserver } from './stateObserver'

export type CodexObserver = Pick<CodexStateObserver, 'snapshot'>

export type CodexClient = Pick<
  CodexAppServerClient,
  'connect' | 'request' | 'respond' | 'subscribe' | 'close' | 'isConnected' | 'connectionGeneration'
>

export interface CodexBackendDependencies {
  readonly observer: CodexObserver
  readonly client: CodexClient
  readonly now?: () => number
}

interface SessionOverlay {
  readonly turnId?: string | null
  readonly turnStartedAt?: string | null
  readonly activity?: AgentSession['activity']
  readonly collaborationMode?: AgentSession['collaborationMode']
  readonly turnOutcome?: AgentSession['turnOutcome']
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

interface ThreadListResult {
  readonly data?: readonly {
    readonly id?: string
    readonly name?: string | null
  }[]
}

/**
 * Codex as one agent backend: the read-only cross-process observer plus the
 * Agent Zen-owned `codex app-server` connection used for sessions launched here.
 */
export class CodexBackend implements AgentBackend {
  readonly agent = 'codex' as const
  readonly controller: SessionController
  private readonly overlays = new Map<string, SessionOverlay>()
  private readonly transientSessions = new Map<string, AgentSession>()
  private readonly ownedThreads = new Map<string, number>()
  private connection: BackendStatus = {
    agent: 'codex',
    connected: false,
    label: 'Connecting to Codex…',
    userAgent: null,
    error: null,
  }

  constructor(private readonly dependencies: CodexBackendDependencies) {
    dependencies.client.subscribe((notification) => this.onNotification(notification))
    this.controller = {
      launch: (request) => this.launchWithCodex(request),
      interrupt: (threadId) => this.interrupt(threadId),
      steer: (threadId, prompt) => this.steer(threadId, prompt),
      respond: (threadId, response) => this.respond(threadId, response),
    }
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
        agent: 'codex',
        connected: true,
        label: 'Live Codex · app-server control + local observer',
        userAgent,
        error: null,
      }
    } catch (error) {
      this.connection = {
        agent: 'codex',
        connected: false,
        label: 'Codex connection unavailable',
        userAgent: null,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  status(): BackendStatus {
    return this.connection
  }

  async observe(): Promise<AgentSession[]> {
    if (!this.dependencies.client.isConnected) await this.start()
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
  }

  close(): Promise<void> {
    return this.dependencies.client.close()
  }

  private async interrupt(threadId: string): Promise<void> {
    const session = await this.controllableSession(threadId)
    if (!session.turnId) throw new Error('This session has no active turn to interrupt.')
    await this.dependencies.client.request('turn/interrupt', {
      threadId,
      turnId: session.turnId,
    })
  }

  private async steer(threadId: string, prompt: string): Promise<void> {
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

  private async respond(threadId: string, response: SessionRequestResponse): Promise<void> {
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

  private async catalogNames(threadIds: readonly string[]): Promise<ReadonlyMap<string, string>> {
    if (!this.connection.connected || threadIds.length === 0) return new Map()
    try {
      const result = await this.dependencies.client.request<ThreadListResult>('thread/list', {
        limit: 100,
        useStateDbOnly: true,
      })
      const wanted = new Set(threadIds)
      const entries = (result.data ?? []).flatMap((thread): [string, string][] => {
        if (typeof thread.id !== 'string' || !wanted.has(thread.id) || typeof thread.name !== 'string') {
          return []
        }
        const name = compactTitle(thread.name)
        return name ? [[thread.id, name]] : []
      })
      return new Map(entries)
    } catch {
      // Catalog metadata must never hide the live board.
      return new Map()
    }
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
      this.ownedThreads.set(threadId, this.dependencies.client.connectionGeneration)
      this.transientSessions.set(threadId, transientSession(thread, request, startedAt))
      const turn = await this.dependencies.client.request<TurnStartResult>('turn/start', {
        threadId,
        input: [{ type: 'text', text: request.prompt, text_elements: [] }],
        model: request.model ?? undefined,
        effort: request.effort ?? undefined,
      })
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
    const session = (await this.observe()).find((candidate) => candidate.id === threadId)
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
        collaborationMode: null,
        hasSubstantiveActivity: false,
        endedAt: null,
        plan: null,
        planHistory: [],
        pendingRequest: null,
        turnOutcome: null,
      })
      return
    }
    if (notification.method === 'thread/settings/updated' && isObject(params.settings)) {
      const collaboration = isObject(params.settings.collaborationMode)
        ? params.settings.collaborationMode.mode
        : null
      if (collaboration === 'plan' || collaboration === 'default') {
        this.overlays.set(threadId, { ...previous, collaborationMode: collaboration })
      }
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
        turnOutcome: isObject(params.turn) && params.turn.status === 'completed'
          ? 'completed'
          : 'aborted',
      })
    }
  }

  private mergeOverlay(session: AgentSession): AgentSession {
    const overlay = this.overlays.get(session.id)
    if (!overlay) return session
    if (overlay.turnId && session.turnId !== overlay.turnId) {
      return { ...session, review: null, wrapup: null, ...overlay }
    }
    return { ...session, ...overlay }
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
    collaborationMode: 'default',
    turnOutcome: null,
    hasSubstantiveActivity: false,
    parentSessionId: null,
    cwd: result.thread.cwd,
    repository: null,
    branch: result.thread.gitInfo?.branch ?? null,
    worktree: result.thread.cwd,
    projectId: null,
    plan: null,
    planHistory: [],
    goal: null,
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
