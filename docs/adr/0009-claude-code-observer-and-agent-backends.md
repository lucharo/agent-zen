# ADR-0009: Claude Code observer and multi-agent backends

- Status: Accepted
- Date: 2026-09-04
- Updated: 2026-10-06

## Outcome

Agent Zen presents Codex and Claude Code sessions on one board through a shared backend contract. Codex keeps its supported App Server controls. Claude Code is observed read-only from files written by the stock CLI; Agent Zen installs no hooks, changes no Claude settings, and requires no wrapper or launch flags.

## Evidence

Claude Code on macOS, observed from 2.1.259 to 2.1.282, maintains three useful local sources:

- `~/.claude/sessions/<pid>.json` identifies live interactive processes and reports session id, cwd, version, status and any waiting reason.
- `~/.claude/projects/<slug>/<session-id>.jsonl` records prompts, assistant activity, titles, model, branch and collaboration mode.
- The transcript's `TaskCreate` and `TaskUpdate` calls and their results record the task list and step status. Older builds also wrote `~/.claude/tasks/<id>/<n>.json`; by 2.1.282 all 96 task directories on this Mac were empty, so those files are only a fallback.

The live registry was observed to distinguish `busy`, `waiting` and `idle`; an ordinary completed turn was `idle` with no waiting reason. 2.1.282 also writes `shell` for an idle prompt with a background shell running, so that status, and any status Agent Zen does not yet know, reads as idle rather than dropping a live session. One `ps` call checks every registry pid in the UTC, C-locale form Claude Code records as `procStart`. A pid whose start time differs now belongs to a later process, and its file is skipped. A live pid that is not Claude is reported as a rejection instead of looking like an empty board. If the process check itself fails, the observation fails rather than counting those sessions as none.

Transcripts carry more than prompts under `type: user`. Only a human prompt that reaches the model starts a turn. Built-in local commands (`/model`, `/effort`, `/compact`) are written `<command-name>` first and followed by their terminal output, so they do not. Nor do background-task notifications, compaction summaries, bash-mode input, CI monitor events or interruption markers. Skill commands such as `/wrapup` are written `<command-message>` first and do start a turn. A session resumed from another directory keeps its id but writes a second transcript, so the newest file its current process has written wins. One session can also run in two processes at once, such as the desktop app and a CLI `--resume`; it still gets one card, taken from the process waiting on the user, then a busy one, then the newest. These formats are version-sensitive implementation details, so one unreadable Claude session is isolated from the others and a whole-backend failure never hides Codex sessions.

## Decision

- Define one `AgentBackend` contract for status, read-only observation, optional control and shutdown. The bridge merges all backend observations, classifies sessions once, and publishes per-backend plus aggregate connection state.
- Keep the Codex implementation behind that boundary without changing its ownership rules. Only sessions launched by the current Agent Zen App Server connection can be steered, interrupted or answered.
- Add a Claude backend with no controller. Every Claude session is external and read-only. A `waiting` registry state becomes Needs you and its reason is shown with instructions to answer in the original terminal.
- Exclude non-interactive Claude processes and registry entries whose pid is no longer alive. A Claude session leaves the board when its registry entry disappears or its process exits.
- Read Claude transcripts incrementally with byte-safe JSONL boundaries, cap any one record at 4 MiB, and cache transcript paths and Git origins. Use complete native command wrappers, direct user-invoked review and wrap-up commands, and skills loaded through the `Skill` tool as workflow hints; other tool activity, incomplete wrappers and prose mentions do not promote a stage. Saying "wrap up" makes the agent load the wrapup skill, which is how most wrap-ups start, so that load counts like typing `/wrapup`. A wrap-up holds for the rest of the session, because the short replies that finish it are new turns; a review lasts for its turn and never displaces a wrap-up.
- Fold the transcript's task-tool calls into the existing current-plan shape, counting an update only when its result reports success, without fabricating revision history or goals.
- Count active root sessions from every backend toward the focus limit. Keep registry-confirmed Claude work in that count when transcript enrichment fails, and fail launch admission closed when any backend workload cannot be observed. A backend whose observation fails keeps its last good sessions on the board beside the failure. The Codex-only launch gate therefore reflects the user's full active workload, even when one agent is hidden in the UI, and is disabled unless the aggregate connection and Codex controller are both explicitly live.
- Persist a non-empty Codex/Claude visibility selection. Show a small agent mark on each card and expose each backend's connection state in Settings and the CLI.
- Advance the bridge protocol to 11 because snapshots now include `agent`, `backends` and multi-agent preferences.
- Raise the global connection alert when Codex, the only agent that can launch, is lost after connecting, even while Claude is connected. A Mac that never had Codex stays quiet, and other backends report in their own Settings row.
- Keep a hidden agent audible: its toolbar toggle carries a dot and says how many of its sessions need you.

## Superseded details

This decision supersedes only these details of earlier accepted ADRs:

- ADR-0001's Codex-only first implementation and column-level Codex mark. The proven product now accepts Codex and Claude together and identifies the agent per card.
- ADR-0002's Codex-only active-membership rule. Codex still uses live rollout ownership; Claude uses its live registry and pid.
- ADR-0005's Codex-only capacity and connection wording. Capacity includes every visible or hidden agent, and Settings reports each backend independently.
- ADR-0008's Codex-only wording for the daemon. It now serves the agent bridge, and its status reports Codex and Claude Code connectivity.

## Consequences

- Claude sessions gain titles, stages, plans, project mapping, Needs-you state and visibility filtering without changing Claude Code itself.
- Claude launch, steer, interrupt, approvals, subagent relationships and goals remain unsupported. ACP can provide a future control backend, but it is not required for observation and is outside this decision.
- Native menu-bar counts include all agents because filtering is a presentation preference, not a change to the canonical snapshot.
- A Claude Code release may change undocumented local formats. The isolated backend and focused parser tests provide the repair boundary.
- Registry identity rejection and partial transcript failures appear in the Claude backend row in Settings, so degraded observation is distinguishable from no running sessions.

## Rejected alternatives

- **Require ACP or `acpx` for every Claude session:** useful for sessions launched through that transport, but it would miss ordinary existing terminals and impose a new launch path.
- **Install Claude hooks:** unnecessary for the observed lifecycle and contrary to the requirement that Claude Code itself remain untouched.
- **Build a second Claude-specific board:** duplicates classification, focus and UI policy instead of adding one backend to the existing model.
- **Read status tags typed into session titles (`[wrapped up]`, `[blocked]`):** a naming habit, not session state. Stages come only from what the agent records on its own, so the board stays automatic.
