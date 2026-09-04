import { describe, expect, test } from 'bun:test'
import { fixtureSessions } from '../src/adapters/fixtureSource'
import type { BridgeSnapshot } from '../src/bridge/types'
import { classifyAgentSession, classifyAgentSessions } from '../src/domain/stage'
import { runExplainCommand, runSessionsCommand } from './sessionCommands'

const NOW = new Date('2026-08-10T17:00:00.000Z').getTime()

function snapshot(): BridgeSnapshot {
  const sessions = fixtureSessions(NOW)
    .filter((session) => !session.endedAt)
  const classified = classifyAgentSessions(sessions)
  return {
    protocolVersion: 11,
    generatedAt: '2026-08-10T17:00:00.000Z',
    connection: { connected: true, label: 'Live Codex', userAgent: 'test', error: null },
    backends: [],
    sessions: classified,
    focus: {
      enabled: false,
      limit: 3,
      activeCount: 2,
      availability: { allowed: true, reason: 'limit-disabled' },
    },
    preferences: null,
    projects: [],
    projectCandidates: [],
  }
}

function io() {
  const output: string[] = []
  return {
    output,
    commandIo: {
      snapshot: async () => snapshot(),
      write: (value: string) => output.push(value),
    },
  }
}

describe('session CLI commands', () => {
  test('lists root sessions with the canonical snapshot classification', async () => {
    const { output, commandIo } = io()

    await runSessionsCommand(['--json'], commandIo)

    const value = JSON.parse(output.join('')) as Record<string, unknown>
    expect(value).toEqual({
      generatedAt: '2026-08-10T17:00:00.000Z',
      protocolVersion: 11,
      sessions: [
        {
          id: 'sess-index-threads',
          agent: 'codex',
          title: 'Index local Codex threads',
          projectId: 'agent-zen',
          activity: 'working',
          stage: 'planning',
          reason: 'plan-mode',
          needsUser: false,
          goal: null,
        },
        {
          id: 'sess-claude-observer',
          agent: 'claude',
          title: 'Claude backend for Agent Zen',
          projectId: 'agent-zen',
          activity: 'working',
          stage: 'running',
          reason: 'active-turn',
          needsUser: false,
          goal: null,
        },
        {
          id: 'sess-control-plane',
          agent: 'codex',
          title: 'Revise calm control plane',
          projectId: 'agent-zen',
          activity: 'working',
          stage: 'running',
          reason: 'active-turn',
          needsUser: false,
          goal: {
            objective: 'Turn Agent Zen into a calm, reliable session control plane.',
            status: 'active',
          },
        },
        {
          id: 'sess-harbor-canary',
          agent: 'codex',
          title: 'Harbor canary review',
          projectId: 'acm',
          activity: 'awaiting-input',
          stage: 'reviewing',
          reason: 'explicit-review-invocation',
          needsUser: true,
          goal: null,
        },
        {
          id: 'sess-retire-dask',
          agent: 'codex',
          title: 'Retire dask join helpers',
          projectId: 'data-pipeline',
          activity: 'working',
          stage: 'wrapping-up',
          reason: 'explicit-wrapup-invocation',
          needsUser: false,
          goal: null,
        },
      ],
    })
  })

  test('explains one session by unique title prefix without reclassifying it', async () => {
    const { output, commandIo } = io()

    await runExplainCommand(['Revise calm', '--json'], commandIo)

    expect(JSON.parse(output.join(''))).toEqual({
      generatedAt: '2026-08-10T17:00:00.000Z',
      protocolVersion: 11,
      session: {
        id: 'sess-control-plane',
        agent: 'codex',
        threadId: '019e21b0-3d54-7f18-8a77-1c0be4d2f905',
        title: 'Revise calm control plane',
        projectId: 'agent-zen',
        cwd: '/Users/demo/Projects/github.com/lucharo/agent-zen',
        parentSessionId: null,
        activity: 'working',
        stage: 'running',
        reason: 'active-turn',
        needsUser: false,
        turnId: 'turn-control-plane',
        plan: { completed: 3, total: 5 },
        goal: {
          objective: 'Turn Agent Zen into a calm, reliable session control plane.',
          status: 'active',
        },
      },
    })
  })

  test('identifies the agent in human-readable session explanations', async () => {
    const { output, commandIo } = io()

    await runExplainCommand(['Claude backend'], commandIo)

    expect(output.join('')).toContain('Agent: Claude Code')
  })

  test('reports aggregate child attention from the canonical classification', async () => {
    const base = snapshot()
    const root = base.sessions.find((session) => session.id === 'sess-control-plane')!
    const aggregate = {
      ...root,
      activity: 'idle' as const,
      classification: { stage: 'idle', reason: 'between-turns', needsUser: true } as const,
    }
    const output: string[] = []

    await runSessionsCommand([], {
      snapshot: async () => ({ ...base, sessions: [aggregate] }),
      write: (value) => output.push(value),
    })

    expect(output.join('')).toContain('Idle\tNeeds you\t')
  })

  test('rejects an ambiguous title prefix', async () => {
    const { commandIo } = io()
    const duplicate = classifyAgentSession({
      ...fixtureSessions(NOW)[1]!,
      id: 'duplicate',
      threadId: 'duplicate',
      title: 'Revise calm copy',
    })
    const base = snapshot()
    const ambiguous = {
      ...commandIo,
      snapshot: async () => ({ ...base, sessions: [...base.sessions, duplicate] }),
    }

    await expect(runExplainCommand(['Revise'], ambiguous)).rejects.toThrow('matches 2 sessions')
  })
})
