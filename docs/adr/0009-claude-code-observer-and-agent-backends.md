# ADR-0009: Claude Code observer and multi-agent backends

- Status: Accepted
- Date: 2026-09-04

## Outcome

Agent Zen presents Codex and Claude Code sessions on one board through a shared backend contract. Codex keeps its supported App Server controls. Claude Code is observed read-only from files written by the stock CLI; Agent Zen installs no hooks, changes no Claude settings, and requires no wrapper or launch flags.

## Evidence

Claude Code 2.1.259 on macOS maintains three useful local sources:

- `~/.claude/sessions/<pid>.json` identifies live interactive processes and reports session id, cwd, version, status and any waiting reason.
- `~/.claude/projects/<slug>/<session-id>.jsonl` records prompts, assistant activity, titles, model, branch and collaboration mode.
- `~/.claude/tasks/<session-id>/*.json`, with a newer short-id directory fallback, records the current task list and step status.

The live registry was observed to distinguish `busy`, `waiting` and `idle`; an ordinary completed turn was `idle` with no waiting reason. Agent Zen also verifies that the recorded pid is still alive. These formats are version-sensitive implementation details, so parse failures degrade only the Claude backend and never hide Codex sessions.

## Decision

- Define one `AgentBackend` contract for status, read-only observation, optional control and shutdown. The bridge merges all backend observations, classifies sessions once, and publishes per-backend plus aggregate connection state.
- Keep the Codex implementation behind that boundary without changing its ownership rules. Only sessions launched by the current Agent Zen App Server connection can be steered, interrupted or answered.
- Add a Claude backend with no controller. Every Claude session is external and read-only. A `waiting` registry state becomes Needs you and its reason is shown with instructions to answer in the original terminal.
- Exclude non-interactive Claude processes and registry entries whose pid is no longer alive. A Claude session leaves the board when its registry entry disappears or its process exits.
- Read Claude transcripts incrementally and cache transcript paths and Git origins. Use explicit user-invoked review and wrap-up commands as workflow hints; tool activity and prose mentions do not promote a stage.
- Project Claude task files into the existing current-plan shape without fabricating revision history or goals.
- Count active root sessions from every backend toward the focus limit. The Codex-only launch gate therefore reflects the user's full active workload, even when one agent is hidden in the UI.
- Persist a non-empty Codex/Claude visibility selection. Show a small agent mark on each card and expose each backend's connection state in Settings and the CLI.
- Advance the bridge protocol to 11 because snapshots now include `agent`, `backends` and multi-agent preferences.

## Superseded details

This decision supersedes only these details of earlier accepted ADRs:

- ADR-0001's Codex-only first implementation and column-level Codex mark. The proven product now accepts Codex and Claude together and identifies the agent per card.
- ADR-0002's Codex-only active-membership rule. Codex still uses live rollout ownership; Claude uses its live registry and pid.
- ADR-0005's Codex-only capacity and connection wording. Capacity includes every visible or hidden agent, and Settings reports each backend independently.

## Consequences

- Claude sessions gain titles, stages, plans, project mapping, Needs-you state and visibility filtering without changing Claude Code itself.
- Claude launch, steer, interrupt, approvals, subagent relationships and goals remain unsupported. ACP can provide a future control backend, but it is not required for observation and is outside this decision.
- Native menu-bar counts include all agents because filtering is a presentation preference, not a change to the canonical snapshot.
- A Claude Code release may change undocumented local formats. The isolated backend and focused parser tests provide the repair boundary.

## Rejected alternatives

- **Require ACP or `acpx` for every Claude session:** useful for sessions launched through that transport, but it would miss ordinary existing terminals and impose a new launch path.
- **Install Claude hooks:** unnecessary for the observed lifecycle and contrary to the requirement that Claude Code itself remain untouched.
- **Build a second Claude-specific board:** duplicates classification, focus and UI policy instead of adding one backend to the existing model.
