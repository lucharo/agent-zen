import type { ClassifiedAgentSession, SessionStage } from './stage'

export type SessionLane = 'needs-you' | SessionStage

export const SESSION_LANES: readonly SessionLane[] = [
  'needs-you',
  'planning',
  'running',
  'reviewing',
  'wrapping-up',
] as const

export const SESSION_LANE_LABELS: Record<SessionLane, string> = {
  'needs-you': 'Needs you',
  planning: 'Planning / Idle',
  running: 'Running',
  reviewing: 'Reviewing',
  'wrapping-up': 'Wrapping up',
}

export interface LaneEntry {
  readonly session: ClassifiedAgentSession
  readonly stage: SessionStage
  readonly children: readonly ClassifiedAgentSession[]
}

export function sessionLane(entry: LaneEntry): SessionLane {
  if (
    entry.session.activity === 'awaiting-input'
    || entry.children.some((child) => child.activity === 'awaiting-input')
  ) return 'needs-you'
  return entry.stage
}
