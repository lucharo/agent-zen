import { describe, expect, it } from 'vitest'
import { fixtureSessions } from '@/adapters/fixtureSource'
import { classifyAgentSession, classifyAgentSessions } from './stage'
import { SESSION_LANES, sessionLane } from './lanes'

const NOW = new Date('2026-08-06T11:00:00Z').getTime()
const sessions = fixtureSessions(NOW).map(classifyAgentSession)

describe('sessionLane', () => {
  it('keeps the accepted session-lane order', () => {
    expect(SESSION_LANES).toEqual([
      'planning',
      'idle',
      'running',
      'needs-you',
      'reviewing',
      'wrapping-up',
      'wrapped-up',
    ])
  })

  it('projects waiting work into Needs you without changing its canonical stage', () => {
    const session = sessions.find((candidate) => candidate.id === 'sess-harbor-canary')!
    const entry = { session, stage: session.classification.stage!, children: [] }

    expect(entry.stage).toBe('reviewing')
    expect(sessionLane(entry)).toBe('needs-you')
  })

  it('keeps a blocked child attached while promoting its root card', () => {
    const root = sessions.find((candidate) => candidate.id === 'sess-control-plane')!
    const child = sessions.find((candidate) => candidate.id === 'sess-fixture-sweep')!
    const [session, classifiedChild] = classifyAgentSessions([
      root,
      { ...child, activity: 'awaiting-input' as const },
    ])
    const entry = {
      session: session!,
      stage: session!.classification.stage!,
      children: [classifiedChild!],
    }

    expect(sessionLane(entry)).toBe('needs-you')
  })
})
