import type { AgentSession, Stage } from './types'

export type SessionStage = Exclude<Stage, 'ideas'>

export type SessionStageReason =
  | 'session-ended'
  | 'wrapup-complete'
  | 'explicit-wrapup-invocation'
  | 'explicit-review-invocation'
  | 'between-turns'
  | 'plan-mode'
  | 'active-turn'

export interface SessionClassification {
  readonly stage: SessionStage | null
  readonly reason: SessionStageReason
  readonly needsUser: boolean
}

const STAGE_REASON_LABELS: Record<SessionStageReason, string> = {
  'session-ended': 'Session ended',
  'wrapup-complete': 'Wrap-up complete',
  'explicit-wrapup-invocation': 'Explicit wrap-up invocation',
  'explicit-review-invocation': 'Explicit review invocation',
  'between-turns': 'Between turns',
  'plan-mode': 'Native Codex plan mode',
  'active-turn': 'Active Codex turn',
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
 * A thread whose Codex process is gone leaves the board entirely. Between-turn
 * work is Idle, while aggregate root-and-descendant attention is published as
 * a separate Needs you signal. Every placement is derived from Codex-owned
 * state: wrapup, review, attention, then native work activity. The Kanban is a
 * projection, not an editor, so no local override can silently contradict the
 * session that produced it.
 */
export function deriveStage(session: AgentSession): Stage | null {
  return classifySession(session).stage
}

/** The single stage decision shared by the daemon snapshot, CLI and UI. */
export function classifySession(session: AgentSession): SessionClassification {
  const needsUser = session.activity === 'awaiting-input'
  if (session.endedAt) return { stage: null, reason: 'session-ended', needsUser }
  const turnActive = session.activity === 'working' || session.activity === 'awaiting-input'
  if (session.wrapup && !turnActive && session.turnOutcome === 'completed') {
    return { stage: 'wrapped-up', reason: 'wrapup-complete', needsUser }
  }
  if (session.wrapup && turnActive) {
    return { stage: 'wrapping-up', reason: 'explicit-wrapup-invocation', needsUser }
  }
  if (session.review && turnActive) {
    return { stage: 'reviewing', reason: 'explicit-review-invocation', needsUser }
  }
  if (!turnActive) return { stage: 'idle', reason: 'between-turns', needsUser }
  if (session.collaborationMode === 'plan') {
    return { stage: 'planning', reason: 'plan-mode', needsUser }
  }
  return { stage: 'running', reason: 'active-turn', needsUser }
}

export function classifyAgentSession(session: AgentSession): ClassifiedAgentSession {
  return { ...session, classification: classifySession(session) }
}

/** Apply root-and-descendant attention before publishing the canonical snapshot. */
export function classifyAgentSessions(
  sessions: readonly AgentSession[],
): ClassifiedAgentSession[] {
  const byId = new Map(sessions.map((session) => [session.id, session]))
  const ancestorsAwaitingInput = new Set<string>()

  for (const session of sessions) {
    if (session.activity !== 'awaiting-input') continue
    const visited = new Set<string>()
    let parentId = session.parentSessionId
    while (parentId && !visited.has(parentId)) {
      visited.add(parentId)
      ancestorsAwaitingInput.add(parentId)
      parentId = byId.get(parentId)?.parentSessionId ?? null
    }
  }

  return sessions.map((session) => {
    const ownClassification = classifySession(session)
    const needsUser = ownClassification.needsUser || ancestorsAwaitingInput.has(session.id)
    if (ownClassification.stage !== 'wrapped-up' || !needsUser) {
      return { ...session, classification: { ...ownClassification, needsUser } }
    }
    return {
      ...session,
      classification: { stage: 'idle', reason: 'between-turns', needsUser },
    }
  })
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
 * Precisely: root sessions whose derived stage is `planning` or `running`.
 * A child agent runs inside its parent's slot; idle, review, wrap-up and
 * wrapped-up sessions do not consume one. That is why a board showing four
 * session cards can honestly read `Active 2 / 3`.
 */
export function activeSessionCount<T extends AgentSession>(
  sessions: readonly T[],
  stageOf: (session: T) => Stage | null,
): number {
  const childrenByParent = new Map<string, T[]>()
  for (const session of sessions) {
    if (!session.parentSessionId) continue
    const children = childrenByParent.get(session.parentSessionId) ?? []
    children.push(session)
    childrenByParent.set(session.parentSessionId, children)
  }
  const branchIsActive = (session: T, visited = new Set<string>()): boolean => {
    if (visited.has(session.id)) return false
    visited.add(session.id)
    const stage = stageOf(session)
    if (stage === 'planning' || stage === 'running') return true
    return (childrenByParent.get(session.id) ?? [])
      .some((child) => branchIsActive(child, new Set(visited)))
  }
  return sessions.filter((session) => !session.parentSessionId && branchIsActive(session)).length
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
