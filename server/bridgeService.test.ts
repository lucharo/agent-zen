import { describe, expect, test } from 'bun:test'
import type { ProjectCandidate } from '../src/adapters/ProjectDiscoverySource'
import type { AgentSession, Project } from '../src/domain/types'
import { AgentZenBridgeService, type BridgeServiceDependencies } from './bridgeService'
import type { AppServerNotification } from './codex/appServerClient'

const project: Project = {
  id: 'project',
  name: 'agent-zen',
  directory: '/repo',
  repository: 'lucharo/agent-zen',
}

class FakeClient {
  isConnected = true
  connectionGeneration = 1
  failTurn = false
  failConnects = 0
  threadNames = new Map<string, string>()
  readonly requests: string[] = []
  readonly requestCalls: Array<{ method: string; params: unknown }> = []
  readonly responses: Array<{ id: number | string; result: unknown }> = []
  private readonly listeners = new Set<(notification: AppServerNotification) => void>()

  async connect(): Promise<Record<string, unknown>> {
    if (this.failConnects > 0) {
      this.failConnects -= 1
      this.isConnected = false
      throw new Error('connect failed')
    }
    this.isConnected = true
    return { userAgent: 'fake-app-server' }
  }

  subscribe(listener: (notification: AppServerNotification) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async request<T>(method: string, params?: unknown): Promise<T> {
    this.requests.push(method)
    this.requestCalls.push({ method, params })
    if (method === 'thread/start') {
      return {
        thread: { id: 'thread-owned', cwd: '/repo', createdAt: 1_786_012_800 },
        model: 'gpt-test',
      } as T
    }
    if (method === 'turn/start') {
      if (this.failTurn) {
        for (const listener of this.listeners) {
          listener({
            method: 'turn/started',
            params: { threadId: 'thread-owned', turn: { id: 'turn-failed' } },
          })
        }
        throw new Error('turn failed')
      }
      return { turn: { id: 'turn-owned', startedAt: 1_786_012_801 } } as T
    }
    if (method === 'thread/read') {
      const threadId = (params as { threadId?: string } | undefined)?.threadId
      return {
        thread: { id: threadId, name: threadId ? this.threadNames.get(threadId) ?? null : null },
      } as T
    }
    return {} as T
  }

  async respond(id: number | string, result: unknown): Promise<void> {
    this.responses.push({ id, result })
  }

  async close(): Promise<void> {
    this.isConnected = false
  }

  notify(notification: AppServerNotification): void {
    for (const listener of this.listeners) listener(notification)
  }
}

function activeExternalSession(id = 'thread-external'): AgentSession {
  return {
    id,
    threadId: id,
    turnId: 'turn-external',
    title: 'External live work',
    agent: 'codex',
    source: 'external',
    model: 'gpt-test',
    reasoningEffort: 'high',
    cliVersion: '0.146.0',
    createdAt: '2026-08-07T08:00:00.000Z',
    turnStartedAt: '2026-08-07T09:00:00.000Z',
    activity: 'working',
    hasSubstantiveActivity: true,
    parentSessionId: null,
    cwd: '/repo',
    repository: 'lucharo/agent-zen',
    branch: 'main',
    worktree: '/repo',
    projectId: project.id,
    plan: null,
    planHistory: [],
    review: null,
    wrapup: null,
    endedAt: null,
  }
}

function dependencies(client: FakeClient): BridgeServiceDependencies {
  const settings: BridgeServiceDependencies['settings'] = {
    read: async () => ({
      version: 2,
      focus: { enabled: false, limit: 3 },
      preferences: null,
      projectRoots: ['/repo'],
      registeredProjectDirectories: ['/repo'],
    }),
    registeredProjects: async () => [project],
    discoverProjects: async () => [] as ProjectCandidate[],
    setFocus: async (focus) => ({
      version: 2,
      focus,
      preferences: null,
      projectRoots: ['/repo'],
      registeredProjectDirectories: ['/repo'],
    }),
    setPreferences: async (preferences) => ({
      version: 2,
      focus: { enabled: false, limit: 3 },
      preferences,
      projectRoots: ['/repo'],
      registeredProjectDirectories: ['/repo'],
    }),
    registerProjects: async () => [project],
  }
  return {
    settings,
    observer: { snapshot: async () => [] },
    client,
    now: () => 1_786_012_802_000,
  }
}

describe('AgentZenBridgeService ownership', () => {
  test('publishes the canonical stage decision in every session snapshot', async () => {
    const client = new FakeClient()
    const deps = dependencies(client)
    const service = new AgentZenBridgeService({
      ...deps,
      observer: { snapshot: async () => [activeExternalSession()] },
    })

    expect((await service.snapshot()).sessions[0]?.classification).toEqual({
      stage: 'running',
      reason: 'substantive-activity',
    })
  })

  test('cleans a partial launch when turn/start fails', async () => {
    const client = new FakeClient()
    client.failTurn = true
    const service = new AgentZenBridgeService(dependencies(client))
    await service.start()

    await expect(service.launch({ projectId: project.id, prompt: 'Do the work' })).rejects.toThrow(
      'turn failed',
    )

    const snapshot = await service.snapshot()
    expect(snapshot.sessions).toEqual([])
    expect(snapshot.focus.activeCount).toBe(0)
    expect(client.requestCalls).toContainEqual({
      method: 'thread/archive',
      params: { threadId: 'thread-owned' },
    })
  })

  test('keeps control only for the app-server connection that launched the thread', async () => {
    const client = new FakeClient()
    const service = new AgentZenBridgeService(dependencies(client))
    await service.start()
    await service.launch({ projectId: project.id, prompt: 'Do the work' })

    expect((await service.snapshot()).sessions[0]?.source).toBe('owned')

    client.connectionGeneration += 1

    expect((await service.snapshot()).sessions[0]?.source).toBe('external')
    await expect(service.interrupt('thread-owned')).rejects.toThrow(
      'controlled by another Codex process',
    )
  })

  test('retries a failed connection through start instead of reconnecting during name lookup', async () => {
    const client = new FakeClient()
    client.isConnected = false
    client.failConnects = 1
    client.threadNames.set('thread-external', 'Renamed after reconnect')
    const deps = dependencies(client)
    const service = new AgentZenBridgeService({
      ...deps,
      observer: { snapshot: async () => [activeExternalSession()] },
    })

    const first = await service.snapshot()
    expect(first.connection.connected).toBe(false)
    expect(first.sessions[0]?.title).toBe('External live work')
    expect(client.requests).not.toContain('thread/read')

    const second = await service.snapshot()
    expect(second.connection.connected).toBe(true)
    expect(second.sessions[0]?.title).toBe('Renamed after reconnect')
  })

  test('owns a new thread before turn/start emits lifecycle notifications', async () => {
    const client = new FakeClient()
    const originalRequest = client.request.bind(client)
    client.request = async <T>(method: string, params?: unknown): Promise<T> => {
      if (method === 'turn/start') {
        client.notify({
          method: 'turn/plan/updated',
          params: {
            threadId: 'thread-owned',
            plan: [{ step: 'Retain the early plan', status: 'inProgress' }],
          },
        })
      }
      return originalRequest<T>(method, params)
    }
    const service = new AgentZenBridgeService(dependencies(client))
    await service.start()

    await service.launch({ projectId: project.id, prompt: 'Do the work' })

    expect((await service.snapshot()).sessions[0]?.plan?.steps).toEqual([
      { step: 'Retain the early plan', status: 'in_progress' },
    ])
  })

  test('keeps an owned session visible and idle after its current turn completes', async () => {
    const client = new FakeClient()
    const service = new AgentZenBridgeService(dependencies(client))
    await service.start()
    await service.launch({ projectId: project.id, prompt: 'Do the work' })

    client.notify({
      method: 'turn/completed',
      params: { threadId: 'thread-owned', turn: { id: 'turn-owned' } },
    })

    const snapshot = await service.snapshot()
    expect(snapshot.sessions.map((session) => session.id)).toEqual(['thread-owned'])
    expect(snapshot.sessions[0]).toMatchObject({ activity: 'idle', endedAt: null })
  })

  test('uses native app-server item and input events for immediate attention state', async () => {
    const client = new FakeClient()
    const service = new AgentZenBridgeService(dependencies(client))
    await service.start()
    await service.launch({ projectId: project.id, prompt: 'Do the work' })

    client.notify({
      method: 'item/started',
      params: {
        threadId: 'thread-owned',
        turnId: 'turn-owned',
        item: { type: 'commandExecution', id: 'item-1' },
      },
    })
    expect((await service.snapshot()).sessions[0]).toMatchObject({
      hasSubstantiveActivity: true,
      activity: 'working',
    })

    client.notify({
      id: 41,
      method: 'item/tool/requestUserInput',
      params: {
        threadId: 'thread-owned',
        turnId: 'turn-owned',
        itemId: 'item-2',
        isBlocking: true,
        questions: [{
          id: 'scope',
          header: 'Scope',
          question: 'Where should this apply?',
          isOther: false,
          isSecret: false,
          options: [{ label: 'Current session', description: 'Only this session.' }],
        }],
      },
    })
    expect((await service.snapshot()).sessions[0]).toMatchObject({
      activity: 'awaiting-input',
      pendingRequest: {
        kind: 'user-input',
        requestId: 41,
        questions: [{ id: 'scope', question: 'Where should this apply?' }],
      },
    })

    await service.respond('thread-owned', {
      requestId: 41,
      kind: 'user-input',
      answers: { scope: ['Current session'] },
    })
    expect(client.responses).toEqual([{
      id: 41,
      result: { answers: { scope: { answers: ['Current session'] } } },
    }])
    expect((await service.snapshot()).sessions[0]).toMatchObject({
      activity: 'working',
      pendingRequest: null,
    })

    client.notify({
      method: 'serverRequest/resolved',
      params: { threadId: 'thread-owned', requestId: 99 },
    })
    expect((await service.snapshot()).sessions[0]?.activity).toBe('working')

    client.notify({
      method: 'serverRequest/resolved',
      params: { threadId: 'thread-owned', requestId: 41 },
    })
    expect((await service.snapshot()).sessions[0]?.activity).toBe('working')
  })

  test('grants the exact native permission request for one turn', async () => {
    const client = new FakeClient()
    const service = new AgentZenBridgeService(dependencies(client))
    await service.start()
    await service.launch({ projectId: project.id, prompt: 'Do the work' })

    client.notify({
      id: 42,
      method: 'item/permissions/requestApproval',
      params: {
        threadId: 'thread-owned',
        turnId: 'turn-owned',
        itemId: 'item-permissions',
        cwd: '/repo',
        reason: 'Write the generated file.',
        permissions: {
          network: null,
          fileSystem: { read: null, write: ['/repo/generated'], entries: null },
        },
      },
    })
    expect((await service.snapshot()).sessions[0]?.pendingRequest).toMatchObject({
      kind: 'permissions',
      requestId: 42,
    })

    await service.respond('thread-owned', {
      requestId: 42,
      kind: 'permissions',
      scope: 'turn',
    })

    expect(client.responses).toEqual([{
      id: 42,
      result: {
        permissions: { fileSystem: { read: null, write: ['/repo/generated'], entries: null } },
        scope: 'turn',
      },
    }])
  })

  test('ignores a stale completion for an older owned turn', async () => {
    const client = new FakeClient()
    const service = new AgentZenBridgeService(dependencies(client))
    await service.start()
    await service.launch({ projectId: project.id, prompt: 'Do the work' })

    client.notify({
      method: 'turn/started',
      params: { threadId: 'thread-owned', turn: { id: 'turn-new' } },
    })
    client.notify({
      method: 'turn/completed',
      params: { threadId: 'thread-owned', turn: { id: 'turn-owned' } },
    })

    expect((await service.snapshot()).sessions[0]).toMatchObject({
      turnId: 'turn-new',
      activity: 'working',
      endedAt: null,
    })
  })

  test('drops a launched transient after the observer has owned and then removed it', async () => {
    const client = new FakeClient()
    let observed: AgentSession[] = []
    const base = dependencies(client)
    const service = new AgentZenBridgeService({
      ...base,
      observer: { snapshot: async () => observed },
    })
    await service.start()
    await service.launch({ projectId: project.id, prompt: 'Do the work' })
    expect((await service.snapshot()).sessions.map((session) => session.id)).toEqual(['thread-owned'])

    observed = [{
      ...activeExternalSession('thread-owned'),
      turnId: 'turn-owned',
      title: 'Do the work',
    }]
    expect((await service.snapshot()).sessions.map((session) => session.id)).toEqual(['thread-owned'])

    observed = []
    expect((await service.snapshot()).sessions).toEqual([])
  })

  test('does not let app-server notifications override externally observed threads', async () => {
    const client = new FakeClient()
    const base = dependencies(client)
    const service = new AgentZenBridgeService({
      ...base,
      observer: { snapshot: async () => [activeExternalSession()] },
    })

    client.notify({
      method: 'turn/completed',
      params: { threadId: 'thread-external', turn: { id: 'turn-external' } },
    })

    const snapshot = await service.snapshot()
    expect(snapshot.sessions.map((session) => session.id)).toEqual(['thread-external'])
    expect(snapshot.sessions[0]?.activity).toBe('working')
  })

  test('uses the native catalog name for a renamed external thread', async () => {
    const client = new FakeClient()
    client.threadNames.set('thread-external', 'Renamed Codex session')
    const base = dependencies(client)
    const service = new AgentZenBridgeService({
      ...base,
      observer: { snapshot: async () => [activeExternalSession()] },
    })
    await service.start()

    const snapshot = await service.snapshot()

    expect(snapshot.sessions[0]?.title).toBe('Renamed Codex session')
  })

  test('registers the Git project of an active observed session', async () => {
    const client = new FakeClient()
    const candidate: ProjectCandidate = {
      id: 'project-live',
      name: 'live-repo',
      directory: '/repos/live-repo',
      repository: 'lucharo/live-repo',
      defaultBranch: 'main',
    }
    const liveProject: Project = candidate
    let registered: Project[] = []
    const registeredCalls: string[][] = []
    const activeSession: AgentSession = {
      ...activeExternalSession('thread-live'),
      cwd: candidate.directory,
      repository: candidate.repository,
      worktree: candidate.directory,
      projectId: candidate.id,
    }
    const base = dependencies(client)
    const service = new AgentZenBridgeService({
      ...base,
      observer: { snapshot: async () => [activeSession] },
      settings: {
        ...base.settings,
        registeredProjects: async () => registered,
        discoverProjects: async () => [candidate],
        registerProjects: async (ids) => {
          registeredCalls.push([...ids])
          registered = ids.includes(candidate.id) ? [liveProject] : registered
          return registered
        },
      },
    })

    const snapshot = await service.snapshot()

    expect(registeredCalls).toEqual([[candidate.id]])
    expect(snapshot.projects).toEqual([liveProject])
    expect(snapshot.sessions[0]?.projectId).toBe(candidate.id)
  })
})
