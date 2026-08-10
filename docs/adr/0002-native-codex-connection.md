# ADR-0002: Native Codex connection with cross-process observation

- Status: Accepted
- Date: 2026-08-06

## Outcome

Agent Zen uses the bundled Codex App Server for supported session control and native protocol events. It observes persisted Codex state for sessions running in other Codex processes. ACP and hooks are not the primary connection.

## Answered grill

- **Does Codex ship the required server?** Yes. Codex CLI 0.147.0 bundles `codex app-server`, JSON-RPC transports, generated schemas, thread inventory/history, turn control, runtime events, and `turn/plan/updated`.
- **Can a fresh app-server see sessions created elsewhere?** It can list persisted sessions, history, repository metadata, and parent-child relationships, but its runtime status for threads loaded by another app-server process is `notLoaded`.
- **Where does cross-process liveness live?** A live `codex` process keeps its current root and child rollout JSONL files open. On macOS, `lsof` exposes those file handles without attaching to the process. `~/.codex/state_5.sqlite` then maps those thread ids to metadata and spawn edges, while the rollout records describe the latest turn.
- **Would ACP solve aggregation?** No. `codex-acp` is an adapter that starts a Codex App Server and translates one ACP session surface. It does not attach to the private stdio connection owned by Codex Desktop.
- **Are hooks required?** No. Native protocol events and persisted rollouts carry the core lifecycle. Hooks add trust, configuration, and failure modes and should remain optional semantic hints.

## Decision

Implement one typed Codex adapter with three internal responsibilities:

1. **Catalog reader:** use `thread/list`, `thread/read(includeTurns=true)`, and parent/ancestor filters for persisted session inventory and history.
2. **Process + rollout observer:** inventory rollout files held open by live Codex processes, query those exact thread ids from the state database, and tail their rollouts for turn activity, current plan updates, model/effort, and parent-child edges. Treat process handles and stores as read-only and version-sensitive.
3. **Controller:** run one Agent Zen-owned bundled `codex app-server --stdio` child for sessions launched through Agent Zen. Use `turn/start`, `turn/steer`, `turn/interrupt`, streamed events, and JSON-RPC server-request responses for control. Keep the transport boundary replaceable by the managed daemon when Codex is installed through the standalone channel that provides it.

Derive the board stage locally:

- `Ideas`: Agent Zen-owned idea; no session.
- `Planning / Idle`: a turn has started without visible work, the process is open between turns, or ordinary work is blocked on native input.
- `Running`: the current turn is working and visible assistant/tool work has begun, or a native plan exists. A plan is optional.
- `Reviewing`: the latest turn contains an explicit review command or an observed allow-listed review-skill load.
- `Wrapping up`: the latest turn contains an explicit wrap-up command or an observed wrap-up skill load.

A prose mention is not an invocation. User-message markers are read only from the first non-empty command line; loaded skill paths use an explicit allow-list, so a helper such as `acm-review` cannot accidentally classify ordinary work as Reviewing. A marker persists for the current turn, and wrap-up has precedence over review. The next native `task_started` event resets the current plan and semantic stage marker.

Attention remains explicit on cards. `working`, `idle`, and `awaiting-input` render as Working, Idle, and Needs you. Reviewing and Wrapping up retain their semantic workflow columns while idle or blocked. Ordinary idle or input-blocked work returns to Planning / Idle so Running means the turn is progressing. Native `request_user_input` call ids are correlated with their outputs. Agent Zen-owned sessions answer supported App Server user-input, command, file-change, and exact permission requests directly; unknown request types stay visible and interruptible but fall back to the native Codex client.

The Kanban is read-only. Agent Zen does not persist human stage overrides. Supported session control is a separate controller action and the resulting Codex state flows back through the same source.

Root sessions are the only peer units on both Sessions projections. Child agents remain attached to that unit: summarized by count on Kanban and Grid cards, and listed with navigation inside the root detail. A child detail identifies and links back to its parent rather than presenting a raw parent id as its only context.

Do not require the agent to maintain another task ledger. Each native plan update replaces the current plan projection while rollout history preserves prior updates.

The local HTTP bridge binds only to `127.0.0.1`, validates loopback `Host` and allowed `Origin` values on every route, and never exposes an arbitrary cwd launch. Launch requests must reference a registered project. Existing external sessions remain read-only; steering and interruption require a thread launched by the current Agent Zen app-server connection. Control ownership is process-scoped and is not restored after a bridge restart.

Every snapshot carries a bridge protocol version. A newer dashboard refuses a stale bridge response and asks for a restart instead of rendering structurally valid but misleading old data. Mutating routes include the protocol version in their URL, so an older bridge rejects an unfamiliar write before changing local state.

The rollout observer keeps the latest lifecycle and native plan records as bounded anchors when a long active turn grows past the ordinary tail window. It does not infer a second plan or ask the agent to republish one.

The observer also keeps a bounded substantive-activity anchor and unresolved input-request anchors. A long working planless turn therefore remains Running, and a request that fell outside the ordinary tail remains Needs you until its matching response arrives in Planning / Idle or its preserved review/wrap-up stage.

The web client requests `/api/snapshot` every second. The observer reuses rollout parses when file size and modification time are unchanged; a separate one-second UI clock updates elapsed-time labels without rescanning Codex.

App Server lifecycle overlays apply only to threads launched by the current bridge connection. Externally owned threads take session membership from the live-process rollout inventory and turn activity from persisted rollout observation. A completed turn becomes idle; it does not end the session or hide the card.

Generated RoboRev execution threads are excluded before stage classification only when their source is `exec` and their normalized generated title starts `You are a code reviewer. Review the code changes shown below.` Human review sessions remain visible. A bare review or wrap-up marker creates no fabricated PR, note, visual-check, or check-count facts; unknown details remain unknown.

Project resolution uses the deepest discovered checkout containing the session cwd, then falls back to normalized GitHub repository identity. This links worktrees outside the main checkout to their project without requiring every worktree to be registered separately.

Sessions leave the focus board when their owning Codex process no longer holds the rollout open or the thread is archived. Agent Zen does not present the unarchived SQLite catalog as an active set or complete history.

## Consequences

- Sessions launched by Agent Zen have the richest live control and event stream.
- Sessions launched in Codex Desktop, terminals, and cloud worktrees remain visible while their local Codex process owns the rollout; idle turns remain on the board without pretending to be running.
- Child agents remain inspectable without inflating the apparent number of independent sessions.
- The adapter must isolate internal SQLite/JSONL parsing so a Codex schema change has one repair point.
- The implementation should generate or vendor types from the installed Codex version during development rather than hand-maintain the protocol.
- The browser UI needs a small local bridge or daemon because it cannot launch `codex app-server` or read `~/.codex` directly.
- A cold observer start inventories live Codex file handles, then may scan backwards through one long active rollout to recover its latest lifecycle and plan anchors; subsequent polling uses a bounded cache.

## Rejected alternatives

- **ACP as the first integration:** useful later for multi-agent portability, but redundant for a Codex-only client and still backed by app-server.
- **Hooks as the event bus:** invasive, trust-gated, and unnecessary for ordinary turn/plan lifecycle.
- **SQLite/JSONL only:** sufficient for observation, but loses supported control, approvals, steering, and streamed protocol semantics.
- **App-server only with a new process:** supported and clean, but cannot report cross-process runtime status for Codex Desktop sessions by itself.
