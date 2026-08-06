import type { AgentSession } from '@/domain/types'

/**
 * The one seam between Agent Zen and a coding agent.
 *
 * Everything above this interface is agent-agnostic; everything below it knows
 * about Codex. Two rules keep the seam honest:
 *
 *  1. It is **read-only**. There is no write method, because agent state is not
 *     ours to write. Ideas, stage overrides and Logbook notes live in Agent
 *     Zen's own store, never here.
 *  2. It is **snapshot + subscribe**, not hooks. Hooks are at best an
 *     additional nudge to re-read; the transport is a poll or a stream over
 *     Codex's own persisted thread state.
 *
 * The fixture implementation in `fixtureSource.ts` satisfies this interface in
 * full. Replacing it with the bundled Codex app-server means implementing the
 * same three members against that protocol and changing one line in
 * `createSessionSource()`.
 */
export interface CodexSessionSource {
  /** Stable identifier for the backing agent, surfaced in the UI. */
  readonly agent: 'codex'

  /** Current state of every known thread, including ended ones. */
  snapshot(): readonly AgentSession[]

  /**
   * Observe changes. Emits the full session list on every change; the UI diffs
   * by id. Returns an unsubscribe function.
   */
  subscribe(listener: (sessions: readonly AgentSession[]) => void): () => void
}

/**
 * Shapes a real app-server adapter has to map from. These mirror the records
 * Codex already writes to `~/.codex/sessions/**.jsonl` and
 * `~/.codex/session_index.jsonl`, so an implementer knows exactly what feeds
 * each `AgentSession` field.
 */
export interface CodexSessionMetaRecord {
  readonly id: string
  readonly timestamp: string
  readonly cwd: string
  readonly originator: string
  readonly cli_version: string
  readonly model_provider: string
}

export interface CodexTurnContextRecord {
  readonly model: string
  readonly cwd: string
}

export interface CodexPlanUpdateRecord {
  readonly explanation: string | null
  readonly plan: ReadonlyArray<{ step: string; status: 'pending' | 'in_progress' | 'completed' }>
}

export interface CodexSessionIndexRecord {
  readonly id: string
  readonly thread_name: string
  readonly updated_at: string
}
