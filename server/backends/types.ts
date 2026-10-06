import type { AgentKind, AgentSession } from '../../src/domain/types'
import type {
  BridgeBackendStatus,
  LaunchSessionResponse,
  SessionRequestResponse,
} from '../../src/bridge/types'
import type { LaunchRequest } from '../domain/focusPolicy'

/**
 * One coding agent as Agent Zen sees it.
 *
 * The bridge service is agent-agnostic: it merges every backend's sessions,
 * classifies them once, and routes control calls by `AgentSession.agent`.
 * Everything that knows how a particular agent persists or exposes its state
 * lives behind this interface, so a second agent is a second implementation,
 * never a second code path in the bridge.
 */
export interface AgentBackend {
  readonly agent: AgentKind
  /** Establish whatever the backend needs. Must not throw; failures show up in `status()`. */
  start(): Promise<void>
  /** The state as of the last `start()` or `observe()`, so health checks never trigger work. */
  status(): BackendStatus
  /**
   * Read-only view of every session this backend can currently see, ended ones
   * included. Throws when the live workload cannot be established; the bridge
   * then keeps the last good view on the board and refuses launches.
   */
  observe(): Promise<AgentSession[]>
  /** `null` for backends Agent Zen only observes. */
  readonly controller: SessionController | null
  close(): Promise<void>
}

export type BackendStatus = BridgeBackendStatus

export interface SessionController {
  launch(request: LaunchRequest): Promise<LaunchSessionResponse>
  interrupt(sessionId: string): Promise<void>
  steer(sessionId: string, prompt: string): Promise<void>
  respond(sessionId: string, response: SessionRequestResponse): Promise<void>
}
