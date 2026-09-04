import type { AgentKind, AgentSession } from '@/domain/types'

/**
 * The one seam between Agent Zen and a coding agent.
 *
 * Everything above this interface is agent-agnostic; everything below it knows
 * about a particular agent. Two rules keep the seam honest:
 *
 *  1. It is **read-only**. There is no write method, because agent state is not
 *     ours to write. Ideas, projects and Logbook notes live in Agent Zen's own
 *     store, never here. Supported steering and turn control belong
 *     in a separate controller boundary when a backend supports it.
 *  2. It is **snapshot + subscribe**, not hooks. Hooks are at best an
 *     additional nudge to re-read; the transport is a poll or a stream over
 *     each agent's own persisted session state.
 *
 * The fixture implementation in `fixtureSource.ts` satisfies this interface in
 * full. The live bridge exposes the same shape after merging its agent
 * backends.
 */
export interface SessionSource {
  /** The agents this source can report on. */
  readonly agents: readonly AgentKind[]
  readonly mode: 'fixture' | 'live'
  readonly label: string

  /** Current state of every known thread, including ended ones. */
  snapshot(): readonly AgentSession[]

  /**
   * Observe changes. Emits the full session list on every change; the UI diffs
   * by id. Returns an unsubscribe function.
   */
  subscribe(listener: (sessions: readonly AgentSession[]) => void): () => void
}

/**
 * Minimal wire shapes a real adapter has to map from. The app-server remains
 * the supported catalog/control surface; read-only `state_5.sqlite` and the
 * indexed rollout JSONL files fill the cross-process liveness and model fields
 * that another app-server process cannot report as loaded.
 */
export interface CodexThreadRecord {
  readonly id: string
  readonly sessionId: string
  readonly cwd: string
  readonly modelProvider: string
  readonly createdAt: number
  readonly updatedAt: number
  readonly parentThreadId: string | null
  readonly status:
    | { readonly type: 'notLoaded' | 'idle' | 'systemError' }
    | { readonly type: 'active'; readonly activeFlags: readonly string[] }
  readonly gitInfo: {
    readonly sha: string | null
    readonly branch: string | null
    readonly originUrl: string | null
  } | null
}

export interface CodexPlanUpdateRecord {
  readonly threadId: string
  readonly turnId: string
  readonly explanation: string | null
  readonly plan: ReadonlyArray<{
    readonly step: string
    readonly status: 'pending' | 'inProgress' | 'completed'
  }>
}

export interface CodexStateThreadRecord {
  readonly id: string
  readonly rollout_path: string
  readonly model: string | null
  readonly reasoning_effort: string | null
  readonly git_branch: string | null
}
