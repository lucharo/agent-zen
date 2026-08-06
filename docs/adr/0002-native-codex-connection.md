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
3. **Controller:** run one Agent Zen-owned bundled `codex app-server --stdio` child for sessions launched through Agent Zen. Use `turn/start`, `turn/steer`, `turn/interrupt`, and streamed events for control. Keep the transport boundary replaceable by the managed daemon when Codex is installed through the standalone channel that provides it.

Derive the board stage locally:

- `Ideas`: Agent Zen-owned idea; no session.
- `Planning`: an active turn exists and no native plan is available.
- `Running`: an active turn exists and a native plan is available.
- `Reviewing`: an explicit review or web-app demo skill marker observed in the current Codex turn.
- `Wrapping up`: an explicit wrap-up skill marker observed in the current Codex turn.

The Kanban is read-only. Agent Zen does not persist human stage overrides. Supported session control is a separate controller action and the resulting Codex state flows back through the same source.

Do not require the agent to maintain another task ledger. Each native plan update replaces the current plan projection while rollout history preserves prior updates.

The local HTTP bridge binds only to `127.0.0.1`, validates loopback `Host` and allowed `Origin` values on every route, and never exposes an arbitrary cwd launch. Launch requests must reference a registered project. Existing external sessions remain read-only; steering and interruption require a thread launched by the current Agent Zen app-server connection. Control ownership is process-scoped and is not restored after a bridge restart.

The rollout observer keeps the latest lifecycle and native plan records as bounded anchors when a long active turn grows past the ordinary tail window. It does not infer a second plan or ask the agent to republish one.

The web client requests `/api/snapshot` every two seconds. The observer reuses rollout parses when file size and modification time are unchanged; a separate one-second UI clock updates elapsed-time labels without rescanning Codex.

Generated RoboRev execution threads are excluded before stage classification only when their source is `exec` and their normalized generated title starts `You are a code reviewer. Review the code changes shown below.` Human review sessions remain visible.

Project resolution uses the deepest discovered checkout containing the session cwd, then falls back to normalized GitHub repository identity. This links worktrees outside the main checkout to their project without requiring every worktree to be registered separately.

Ended sessions leave the focus board. Agent Zen does not present the observer's bounded recent-thread window as complete history.

## Consequences

- Sessions launched by Agent Zen have the richest live control and event stream.
- Sessions launched in Codex Desktop remain visible through persisted native state; control may require resuming them through Agent Zen after their external turn is idle.
- The adapter must isolate internal SQLite/JSONL parsing so a Codex schema change has one repair point.
- The implementation should generate or vendor types from the installed Codex version during development rather than hand-maintain the protocol.
- The browser UI needs a small local bridge or daemon because it cannot launch `codex app-server` or read `~/.codex` directly.
- A cold observer start may scan backwards through one long active rollout to recover its latest lifecycle and plan anchors; subsequent polling uses a bounded cache.

## Rejected alternatives

- **ACP as the first integration:** useful later for multi-agent portability, but redundant for a Codex-only client and still backed by app-server.
- **Hooks as the event bus:** invasive, trust-gated, and unnecessary for ordinary turn/plan lifecycle.
- **SQLite/JSONL only:** sufficient for observation, but loses supported control, approvals, steering, and streamed protocol semantics.
- **App-server only with a new process:** supported and clean, but cannot report cross-process runtime status for Codex Desktop sessions by itself.
