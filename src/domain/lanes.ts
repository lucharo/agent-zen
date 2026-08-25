import type { ClassifiedAgentSession, SessionStage } from './stage'

export type SessionLane = 'needs-you' | SessionStage

export const SESSION_LANES: readonly SessionLane[] = [
  'planning',
  'idle',
  'running',
  'needs-you',
  'reviewing',
  'wrapping-up',
  'wrapped-up',
] as const

export const SESSION_LANE_LABELS: Record<SessionLane, string> = {
  'needs-you': 'Needs you',
  planning: 'Planning',
  idle: 'Idle',
  running: 'Running',
  reviewing: 'Reviewing',
  'wrapping-up': 'Wrapping up',
  'wrapped-up': 'Wrapped up',
}

export interface LaneEntry {
  readonly session: ClassifiedAgentSession
  readonly stage: SessionStage
  readonly children: readonly ClassifiedAgentSession[]
}

export function sessionLane(entry: LaneEntry): SessionLane {
  if (entry.session.classification.needsUser) return 'needs-you'
  return entry.stage
}
