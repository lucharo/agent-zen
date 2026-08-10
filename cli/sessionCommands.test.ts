import { describe, expect, test } from 'bun:test'
import { fixtureSessions } from '../src/adapters/fixtureSource'
import type { BridgeSnapshot } from '../src/bridge/types'
import { classifyAgentSession } from '../src/domain/stage'
import { runExplainCommand, runSessionsCommand } from './sessionCommands'

const NOW = new Date('2026-08-10T17:00:00.000Z').getTime()

function snapshot(): BridgeSnapshot {
  const sessions = fixtureSessions(NOW)
    .filter((session) => !session.endedAt)
    .map(classifyAgentSession)
  return {
    protocolVersion: 6,
    generatedAt: '2026-08-10T17:00:00.000Z',
    connection: { connected: true, label: 'Live Codex', userAgent: 'test', error: null },
    sessions,
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
      protocolVersion: 6,
      sessions: [
        {
          id: 'sess-index-threads',
          title: 'Index local Codex threads',
          projectId: 'agent-zen',
          activity: 'working',
          stage: 'planning',
          reason: 'turn-starting',
        },
        {
          id: 'sess-control-plane',
          title: 'Revise calm control plane',
          projectId: 'agent-zen',
          activity: 'working',
          stage: 'running',
          reason: 'active-plan',
        },
        {
          id: 'sess-harbor-canary',
          title: 'Harbor canary review',
          projectId: 'acm',
          activity: 'awaiting-input',
          stage: 'reviewing',
          reason: 'explicit-review-invocation',
        },
        {
          id: 'sess-retire-dask',
          title: 'Retire dask join helpers',
          projectId: 'data-pipeline',
          activity: 'working',
          stage: 'wrapping-up',
          reason: 'explicit-wrapup-invocation',
        },
      ],
    })
  })

  test('explains one session by unique title prefix without reclassifying it', async () => {
    const { output, commandIo } = io()

    await runExplainCommand(['Revise calm', '--json'], commandIo)

    expect(JSON.parse(output.join(''))).toEqual({
      generatedAt: '2026-08-10T17:00:00.000Z',
      protocolVersion: 6,
      session: {
        id: 'sess-control-plane',
        threadId: '019e21b0-3d54-7f18-8a77-1c0be4d2f905',
        title: 'Revise calm control plane',
        projectId: 'agent-zen',
        cwd: '/Users/demo/Projects/github.com/lucharo/agent-zen',
        parentSessionId: null,
        activity: 'working',
        stage: 'running',
        reason: 'active-plan',
        turnId: 'turn-control-plane',
        plan: { completed: 3, total: 5 },
      },
    })
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
