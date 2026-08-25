import { describe, expect, it } from 'vitest'
import { fixtureSessions } from '@/adapters/fixtureSource'
import { classifyAgentSession } from './stage'
import { sessionLane } from './lanes'

const NOW = new Date('2026-08-06T11:00:00Z').getTime()
const sessions = fixtureSessions(NOW).map(classifyAgentSession)

describe('sessionLane', () => {
  it('projects waiting work into Needs you without changing its canonical stage', () => {
    const session = sessions.find((candidate) => candidate.id === 'sess-harbor-canary')!
    const entry = { session, stage: session.classification.stage!, children: [] }

    expect(entry.stage).toBe('reviewing')
    expect(sessionLane(entry)).toBe('needs-you')
  })

  it('keeps a blocked child attached while promoting its root card', () => {
    const session = sessions.find((candidate) => candidate.id === 'sess-control-plane')!
    const child = sessions.find((candidate) => candidate.id === 'sess-fixture-sweep')!
    const entry = {
      session,
      stage: session.classification.stage!,
      children: [{ ...child, activity: 'awaiting-input' as const }],
    }

    expect(sessionLane(entry)).toBe('needs-you')
  })
})
