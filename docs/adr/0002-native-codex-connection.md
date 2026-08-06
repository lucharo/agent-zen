# ADR-0002: Native Codex connection with cross-process observation

- Status: Accepted
- Date: 2026-08-06

## Outcome

Agent Zen uses the bundled Codex App Server for supported session control and native protocol events. It observes persisted Codex state for sessions running in other Codex processes. ACP and hooks are not the primary connection.

## Answered grill

- **Does Codex ship the required server?** Yes. Codex CLI 0.146.0 bundles `codex app-server`, JSON-RPC transports, generated schemas, thread inventory/history, turn control, runtime events, and `turn/plan/updated`.
- **Can a fresh app-server see sessions created elsewhere?** It can list persisted sessions, history, repository metadata, and parent-child relationships, but its runtime status for threads loaded by another app-server process is `notLoaded`.
- **Where does cross-process liveness live?** Codex continuously appends turn lifecycle, plan/tool, and completion events to per-thread rollouts under `~/.codex/sessions/`; `~/.codex/state_5.sqlite` indexes thread metadata, model, reasoning effort, rollout path, and spawn edges.
- **Would ACP solve aggregation?** No. `codex-acp` is an adapter that starts a Codex App Server and translates one ACP session surface. It does not attach to the private stdio connection owned by Codex Desktop.
- **Are hooks required?** No. Native protocol events and persisted rollouts carry the core lifecycle. Hooks add trust, configuration, and failure modes and should remain optional semantic hints.

## Decision

Implement one typed Codex adapter with three internal responsibilities:

1. **Catalog reader:** use `thread/list`, `thread/read(includeTurns=true)`, and parent/ancestor filters for persisted session inventory and history.
2. **Rollout observer:** read the state database and tail only the indexed rollout files to detect turns running in other Codex processes, current plan updates, model/effort, and parent-child edges. Treat these stores as read-only and version-sensitive.
3. **Controller:** run one Agent Zen-owned app-server process or daemon for sessions launched or resumed through Agent Zen. Use `turn/start`, `turn/steer`, `turn/interrupt`, `review/start`, and streamed events for control.

Derive the board stage locally:

- `Ideas`: Agent Zen-owned idea; no session.
- `Planning`: an active turn exists and no native plan is available.
- `Running`: an active turn exists and a native plan is available.
- `Reviewing`: native review mode or an observed review action/skill marker in the Codex rollout.
- `Wrapping up`: an observed wrap-up skill invocation or wrap-up result in the Codex rollout.

The Kanban is read-only. Agent Zen does not persist human stage overrides. Supported session control is a separate controller action and the resulting Codex state flows back through the same source.

Do not require the agent to maintain another task ledger. Each native plan update replaces the current plan projection while rollout history preserves prior updates.

## Consequences

- Sessions launched by Agent Zen have the richest live control and event stream.
- Sessions launched in Codex Desktop remain visible through persisted native state; control may require resuming them through Agent Zen after their external turn is idle.
- The adapter must isolate internal SQLite/JSONL parsing so a Codex schema change has one repair point.
- The implementation should generate or vendor types from the installed Codex version during development rather than hand-maintain the protocol.
- The browser UI needs a small local bridge or daemon because it cannot launch `codex app-server` or read `~/.codex` directly.

## Rejected alternatives

- **ACP as the first integration:** useful later for multi-agent portability, but redundant for a Codex-only client and still backed by app-server.
- **Hooks as the event bus:** invasive, trust-gated, and unnecessary for ordinary turn/plan lifecycle.
- **SQLite/JSONL only:** sufficient for observation, but loses supported control, approvals, steering, and streamed protocol semantics.
- **App-server only with a new process:** supported and clean, but cannot report cross-process runtime status for Codex Desktop sessions by itself.
