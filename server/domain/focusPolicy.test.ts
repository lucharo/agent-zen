import { describe, expect, test } from 'bun:test'
import type { AgentSession } from '../../src/domain/types'
import { FocusLimitReachedError, LaunchCoordinator } from './focusPolicy'

const session = (overrides: Partial<AgentSession> = {}): AgentSession => ({
  id: 'root',
  threadId: 'thread-root',
  title: 'Root session',
  agent: 'codex',
  source: 'external',
  model: 'gpt-test',
  reasoningEffort: null,
  cliVersion: 'test',
  createdAt: '2026-08-06T12:00:00.000Z',
  turnStartedAt: '2026-08-06T12:00:00.000Z',
  turnId: 'turn-root',
  activity: 'working',
  hasSubstantiveActivity: false,
  parentSessionId: null,
  cwd: '/repo',
  repository: 'lucharo/repo',
  branch: 'main',
  worktree: '/repo',
  projectId: 'repo',
  plan: null,
  planHistory: [],
  goal: null,
  review: null,
  wrapup: null,
  endedAt: null,
  ...overrides,
})

describe('LaunchCoordinator', () => {
  test('refuses a new root launch at the enabled limit without calling Codex', async () => {
    let called = 0
    const coordinator = new LaunchCoordinator({
      getSessions: () => [session()],
      getFocus: () => ({ enabled: true, limit: 1 }),
      launch: async () => {
        called += 1
        return { threadId: 'new-thread', turnId: 'new-turn' }
      },
    })

    await expect(coordinator.launch({ cwd: '/repo', prompt: 'Do the work' })).rejects.toBeInstanceOf(
      FocusLimitReachedError,
    )
    expect(called).toBe(0)
  })

  test('children share their parent slot and review sessions release capacity', async () => {
    const sessions = [
      session(),
      session({ id: 'child', threadId: 'child', parentSessionId: 'root' }),
      session({ id: 'review', threadId: 'review', review: { visualChecked: true, prReady: false, openNotes: 1, pullRequest: null } }),
    ]
    const coordinator = new LaunchCoordinator({
      getSessions: () => sessions,
      getFocus: () => ({ enabled: true, limit: 2 }),
      launch: async () => ({ threadId: 'new-thread', turnId: 'new-turn' }),
    })

    await expect(coordinator.launch({ cwd: '/repo', prompt: 'Do the work' })).resolves.toEqual({
      threadId: 'new-thread',
      turnId: 'new-turn',
    })
  })

  test('serialises competing launches so only one can claim the final slot', async () => {
    const sessions: AgentSession[] = []
    let launches = 0
    const coordinator = new LaunchCoordinator({
      getSessions: () => sessions,
      getFocus: () => ({ enabled: true, limit: 1 }),
      launch: async () => {
        launches += 1
        sessions.push(session({ id: `root-${launches}`, threadId: `thread-${launches}` }))
        return { threadId: `thread-${launches}`, turnId: `turn-${launches}` }
      },
    })

    const results = await Promise.allSettled([
      coordinator.launch({ cwd: '/repo', prompt: 'First' }),
      coordinator.launch({ cwd: '/repo', prompt: 'Second' }),
    ])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect(launches).toBe(1)
  })
})
