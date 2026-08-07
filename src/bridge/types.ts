import type { ProjectCandidate } from '@/adapters/ProjectDiscoverySource'
import type { LaunchAvailability } from '@/domain/stage'
import type { AgentSession, Project } from '@/domain/types'

export const BRIDGE_PROTOCOL_VERSION = 2

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
  readonly sessions: readonly AgentSession[]
  readonly focus: BridgeFocusState
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
