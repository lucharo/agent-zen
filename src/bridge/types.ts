import type { ProjectCandidate } from '@/adapters/ProjectDiscoverySource'
import type { UiPreferences } from '@/domain/preferences'
import type { ClassifiedAgentSession, LaunchAvailability } from '@/domain/stage'
import type {
  Project,
  SessionApprovalDecision,
  SessionRequestId,
} from '@/domain/types'

export const BRIDGE_PROTOCOL_VERSION = 10
export const BRIDGE_MUTATION_PATH = `/api/v${BRIDGE_PROTOCOL_VERSION}`

export interface BridgeConnectionStatus {
  readonly connected: boolean
  readonly label: string
  readonly userAgent: string | null
  readonly error: string | null
}

export interface BridgeFocusState {
  readonly enabled: boolean
  readonly limit: number
  readonly activeCount: number
  readonly availability: LaunchAvailability
}

export interface BridgeSnapshot {
  readonly protocolVersion: number
  readonly generatedAt: string
  readonly connection: BridgeConnectionStatus
  readonly sessions: readonly ClassifiedAgentSession[]
  readonly focus: BridgeFocusState
  readonly preferences: UiPreferences | null
  readonly projects: readonly Project[]
  readonly projectCandidates: readonly ProjectCandidate[]
}

export interface LaunchSessionPayload {
  readonly projectId: string
  readonly prompt: string
  readonly model?: string | null
  readonly effort?: string | null
}

export interface LaunchSessionResponse {
  readonly threadId: string
  readonly turnId: string
}

export type SessionRequestResponse =
  | {
      readonly requestId: SessionRequestId
      readonly kind: 'user-input'
      readonly answers: Readonly<Record<string, readonly string[]>>
    }
  | {
      readonly requestId: SessionRequestId
      readonly kind: 'approval'
      readonly decision: SessionApprovalDecision
    }
  | {
      readonly requestId: SessionRequestId
      readonly kind: 'permissions'
      readonly scope: 'turn' | 'session'
    }
