import type { AgentSession, Stage } from './types'

export type SessionStage = Exclude<Stage, 'ideas'>

export type SessionStageReason =
  | 'session-ended'
  | 'explicit-wrapup-invocation'
  | 'explicit-review-invocation'
  | 'awaiting-input'
  | 'between-turns'
  | 'active-plan'
  | 'substantive-activity'
  | 'turn-starting'

export interface SessionClassification {
  readonly stage: SessionStage | null
  readonly reason: SessionStageReason
}

const STAGE_REASON_LABELS: Record<SessionStageReason, string> = {
  'session-ended': 'Session ended',
  'explicit-wrapup-invocation': 'Explicit wrap-up invocation',
  'explicit-review-invocation': 'Explicit review invocation',
  'awaiting-input': 'Waiting for your input',
  'between-turns': 'Between turns',
  'active-plan': 'Active Codex plan',
  'substantive-activity': 'Visible assistant or tool activity',
  'turn-starting': 'Turn just started',
}

export function stageReasonLabel(reason: SessionStageReason): string {
  return STAGE_REASON_LABELS[reason]
}

export interface ClassifiedAgentSession extends AgentSession {
  readonly classification: SessionClassification
}

/**
 * Where a session sits on the board, or `null` once it has left the focus surface.
 *
 * A thread whose Codex process is gone leaves the board entirely. Idle or
 * input-blocked ordinary work returns to the first session column rather than
 * claiming it is Running. Every placement is derived from Codex-owned state:
 * wrapup, review, attention, then native work activity. The Kanban is a
 * projection, not an editor, so no local override can silently contradict the
 * session that produced it.
 */
export function deriveStage(session: AgentSession): Stage | null {
  return classifySession(session).stage
}

/** The single stage decision shared by the daemon snapshot, CLI and UI. */
export function classifySession(session: AgentSession): SessionClassification {
  if (session.endedAt) return { stage: null, reason: 'session-ended' }
  if (session.wrapup) return { stage: 'wrapping-up', reason: 'explicit-wrapup-invocation' }
  if (session.review) return { stage: 'reviewing', reason: 'explicit-review-invocation' }
  if (session.activity === 'awaiting-input') return { stage: 'planning', reason: 'awaiting-input' }
  if (session.activity !== 'working') return { stage: 'planning', reason: 'between-turns' }
  if (session.plan?.steps.length) return { stage: 'running', reason: 'active-plan' }
  if (session.hasSubstantiveActivity) return { stage: 'running', reason: 'substantive-activity' }
  return { stage: 'planning', reason: 'turn-starting' }
}

export function classifyAgentSession(session: AgentSession): ClassifiedAgentSession {
  return { ...session, classification: classifySession(session) }
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
 * Precisely: root sessions whose derived stage is `planning` or `running`. The
 * first bucket includes live sessions that are starting, idle, or need input. A
 * child agent runs inside its parent's slot, and `reviewing` / `wrapping up`
 * are waiting on a human, so neither consumes one. That is why a board showing
 * four session cards can honestly read `Active 2 / 3`.
 */
export function activeSessionCount<T extends AgentSession>(
  sessions: readonly T[],
  stageOf: (session: T) => Stage | null,
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
