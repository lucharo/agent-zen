import type { AgentSession, Stage } from './types'

/**
 * Where a session sits on the board, or `null` once it has left the focus surface.
 *
 * An ended thread leaves the board entirely. Every other placement is derived
 * from Codex-owned state: wrapup, review, then the native plan. The Kanban is a
 * projection, not an editor, so no local override can silently contradict the
 * session that produced it.
 */
export function deriveStage(session: AgentSession): Stage | null {
  if (session.endedAt) return null
  return nativeStage(session)
}

/** Stage implied purely by agent-reported state. */
export function nativeStage(session: AgentSession): Stage {
  if (session.wrapup) return 'wrapping-up'
  if (session.review) return 'reviewing'
  return planStage(session)
}

function planStage(session: AgentSession): Stage {
  return session.plan && session.plan.steps.length > 0 ? 'running' : 'planning'
}

/** The plan step the agent is on right now, or `null` while planning. */
export function currentPlanStep(session: AgentSession): string | null {
  const active = session.plan?.steps.find((s) => s.status === 'in_progress')
  return active?.step ?? null
}

export interface PlanProgress {
  readonly completed: number
  readonly total: number
}

export function planProgress(session: AgentSession): PlanProgress | null {
  const steps = session.plan?.steps
  if (!steps?.length) return null
  const activeIndex = steps.findIndex((s) => s.status === 'in_progress')
  const completed = steps.filter((s) => s.status === 'completed').length
  // A step in flight reads as "on step N of M", which is what the card shows.
  return { completed: activeIndex === -1 ? completed : activeIndex + 1, total: steps.length }
}

/**
 * How many concurrency slots are in use.
 *
 * Precisely: root sessions whose derived stage is `planning` or `running`. A
 * child agent runs inside its parent's slot, and `reviewing` / `wrapping up`
 * are waiting on a human, so neither consumes one. That is why a board showing
 * four session cards can honestly read `Active 2 / 3`.
 */
export function activeSessionCount(
  sessions: readonly AgentSession[],
  stageOf: (session: AgentSession) => Stage | null,
): number {
  return sessions.filter((s) => {
    if (s.parentSessionId) return false
    const stage = stageOf(s)
    return stage === 'planning' || stage === 'running'
  }).length
}

export interface LaunchAvailability {
  readonly allowed: boolean
  readonly reason: 'limit-disabled' | 'slot-available' | 'limit-reached'
}

/**
 * The focus limit is a launch guard, never a process killer. Existing work is
 * left alone; only a new root session is refused once every slot is occupied.
 */
export function launchAvailability(
  active: number,
  enabled: boolean,
  limit: number,
): LaunchAvailability {
  if (!enabled) return { allowed: true, reason: 'limit-disabled' }
  if (active < limit) return { allowed: true, reason: 'slot-available' }
  return { allowed: false, reason: 'limit-reached' }
}
