import type { AgentSession, SemanticEvent, Stage, StageOverride } from './types'

export interface StageInputs {
  /** A human placement. Outranks the agent's own state. */
  readonly override?: StageOverride | undefined
  /** All semantic events for this session, in any order. */
  readonly events?: readonly SemanticEvent[] | undefined
}

/**
 * Where a session sits on the board, or `null` when it belongs in the archive
 * rather than the focus surface.
 *
 * The ladder, highest precedence first:
 *
 *  1. An ended thread leaves the board entirely. There is no Done column.
 *  2. A human stage override.
 *  3. The latest semantic event Agent Zen recorded.
 *  4. The agent's own reported state: wrapup, then review, then the native plan.
 *
 * Step 4 is what keeps this honest — with no local state at all, a session
 * still lands in the right column purely from what Codex already persists.
 */
export function deriveStage(session: AgentSession, inputs: StageInputs = {}): Stage | null {
  if (session.endedAt) return null
  if (inputs.override) return inputs.override.stage

  const latest = latestEvent(inputs.events, session.id)
  if (latest?.kind === 'wrapup-invoked') return 'wrapping-up'
  if (latest?.kind === 'review-requested') return 'reviewing'
  // `returned-to-work` deliberately discards the agent's stale review and
  // wrapup signals, which is the whole point of recording it.
  if (latest?.kind === 'returned-to-work') return planStage(session)

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

function latestEvent(
  events: readonly SemanticEvent[] | undefined,
  sessionId: string,
): SemanticEvent | undefined {
  if (!events?.length) return undefined
  return events
    .filter((e) => e.sessionId === sessionId)
    .reduce<SemanticEvent | undefined>(
      (best, e) => (!best || e.at > best.at ? e : best),
      undefined,
    )
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
