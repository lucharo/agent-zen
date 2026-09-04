import { describe, expect, test } from 'bun:test'
import type { AgentKind, AgentSession, Project } from '../../src/domain/types'
import { AgentZenBridgeService, type BridgeServiceDependencies } from '../bridgeService'
import type { AgentBackend } from './types'

const project: Project = {
  id: 'project',
  name: 'agent-zen',
  directory: '/repo',
  repository: 'lucharo/agent-zen',
}

const settings: BridgeServiceDependencies['settings'] = {
  read: async () => ({
    version: 2,
    focus: { enabled: false, limit: 3 },
    preferences: null,
    projectRoots: ['/repo'],
    registeredProjectDirectories: ['/repo'],
  }),
  registeredProjects: async () => [project],
  discoverProjects: async () => [],
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

function session(id: string, agent: AgentKind, overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id,
    threadId: id,
    turnId: `${id}-turn`,
    title: `${agent} work`,
    agent,
    source: 'external',
    model: 'model',
    reasoningEffort: null,
    cliVersion: null,
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
    goal: null,
    review: null,
    wrapup: null,
    endedAt: null,
    ...overrides,
  }
}

function readOnlyBackend(
  agent: AgentKind,
  sessions: AgentSession[],
  error: string | null = null,
): AgentBackend {
  return {
    agent,
    controller: null,
    start: async () => undefined,
    status: () => ({ agent, connected: error === null, label: `${agent} observer`, userAgent: null, error }),
    observe: async () => sessions,
    close: async () => undefined,
  }
}

describe('AgentZenBridgeService with several agent backends', () => {
  test('merges every backend into one classified board and reports each connection', async () => {
    const service = new AgentZenBridgeService({
      settings,
      backends: [
        readOnlyBackend('codex', [session('codex-1', 'codex')]),
        readOnlyBackend('claude', [
          session('claude-1', 'claude', { createdAt: '2026-08-08T08:00:00.000Z' }),
          session('claude-ended', 'claude', { endedAt: '2026-08-08T09:00:00.000Z' }),
        ]),
      ],
    })

    const snapshot = await service.snapshot()
    expect(snapshot.sessions.map((entry) => [entry.id, entry.agent, entry.classification.stage])).toEqual([
      ['claude-1', 'claude', 'running'],
      ['codex-1', 'codex', 'running'],
    ])
    expect(snapshot.backends.map((backend) => [backend.agent, backend.connected])).toEqual([
      ['codex', true],
      ['claude', true],
    ])
    expect(snapshot.connection).toEqual({
      connected: true,
      label: 'codex observer / claude observer',
      userAgent: null,
      error: null,
    })
    expect(snapshot.focus.activeCount).toBe(2)
  })

  test('a failed backend never hides the others', async () => {
    const service = new AgentZenBridgeService({
      settings,
      backends: [
        readOnlyBackend('codex', [], 'codex exploded'),
        readOnlyBackend('claude', [session('claude-1', 'claude')]),
      ],
    })

    const snapshot = await service.snapshot()
    expect(snapshot.sessions.map((entry) => entry.id)).toEqual(['claude-1'])
    expect(snapshot.connection.connected).toBe(true)
    expect(snapshot.backends.find((backend) => backend.agent === 'codex')?.error).toBe('codex exploded')
    expect(service.health().backends).toHaveLength(2)
  })

  test('isolates an observation rejection and reports that backend unavailable', async () => {
    const failing = {
      ...readOnlyBackend('codex', []),
      observe: async (): Promise<AgentSession[]> => {
        throw new Error('codex observation exploded')
      },
    }
    const service = new AgentZenBridgeService({
      settings,
      backends: [failing, readOnlyBackend('claude', [session('claude-1', 'claude')])],
    })

    const snapshot = await service.snapshot()

    expect(snapshot.sessions.map((entry) => entry.id)).toEqual(['claude-1'])
    expect(snapshot.connection.connected).toBe(true)
    expect(snapshot.backends.find((backend) => backend.agent === 'codex')).toMatchObject({
      connected: false,
      error: 'codex observation exploded',
    })
  })

  test('isolates a startup rejection and reports that backend unavailable', async () => {
    const failing = {
      ...readOnlyBackend('codex', []),
      start: async (): Promise<void> => {
        throw new Error('codex startup exploded')
      },
    }
    const service = new AgentZenBridgeService({
      settings,
      backends: [failing, readOnlyBackend('claude', [])],
    })

    await expect(service.start()).resolves.toBeUndefined()
    expect(service.health().backends.find((backend) => backend.agent === 'codex')).toMatchObject({
      connected: false,
      error: 'codex startup exploded',
    })
  })

  test('reports disconnected with the Codex line leading when nothing is connected', async () => {
    const service = new AgentZenBridgeService({
      settings,
      backends: [
        readOnlyBackend('claude', [], 'no registry'),
        readOnlyBackend('codex', [], 'codex exploded'),
      ],
    })

    expect(service.health().connection).toEqual({
      connected: false,
      label: 'codex observer',
      userAgent: null,
      error: 'codex exploded',
    })
  })

  test('refuses control calls for a session whose backend is read-only', async () => {
    const service = new AgentZenBridgeService({
      settings,
      backends: [readOnlyBackend('claude', [session('claude-1', 'claude')])],
    })

    await expect(service.interrupt('claude-1')).rejects.toThrow('read-only in Agent Zen')
    await expect(service.steer('claude-1', 'hi')).rejects.toThrow('read-only in Agent Zen')
    await expect(service.respond('claude-1', {
      requestId: 1,
      kind: 'permissions',
      scope: 'turn',
    })).rejects.toThrow('read-only in Agent Zen')
    await expect(service.launch({ projectId: project.id, prompt: 'Do the work' })).rejects.toThrow(
      'Codex is not available',
    )
  })

  test('recovers a backend after a transient observation failure', async () => {
    let attempts = 0
    const recovering = {
      ...readOnlyBackend('claude', []),
      observe: async (): Promise<AgentSession[]> => {
        attempts += 1
        if (attempts === 1) throw new Error('temporary failure')
        return [session('claude-1', 'claude')]
      },
    }
    const service = new AgentZenBridgeService({ settings, backends: [recovering] })

    expect((await service.snapshot()).backends[0]).toMatchObject({ connected: false, error: 'temporary failure' })
    const recovered = await service.snapshot()
    expect(recovered.sessions.map((entry) => entry.id)).toEqual(['claude-1'])
    expect(recovered.backends[0]).toMatchObject({ connected: true, error: null })
  })
})
