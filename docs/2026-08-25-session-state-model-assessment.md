# Session state model assessment

Status: accepted design contract for [issue #18](https://github.com/lucharo/agent-zen/issues/18). Evidence checked on 2026-08-25 against Codex CLI 0.149.1. This document records the contract; classifier changes belong in a separate tested change.

![Agent Zen state-boundary infographic](assets/2026-08-25-agent-zen-state-boundaries.png)

The diagram shows the implemented boundary: native Codex evidence feeds one ordered classifier, then `Needs you` can override the visible lane without replacing the workflow phase. Its reproducible GenIMG prompt is in [docs/assets/2026-08-25-agent-zen-state-boundaries.prompt.md](assets/2026-08-25-agent-zen-state-boundaries.prompt.md).

## Intended model

The board vocabulary and visible order are:

| Board state | Meaning |
| --- | --- |
| Ideas | Human-captured ideas with no linked session. |
| Planning | The agent is in plan mode. |
| Idle | The session is live but has no active turn or human request. |
| Running | Actively building or executing work outside the named workflow phases. |
| Needs you | A human response or decision is required. |
| Reviewing | An explicitly invoked review turn is active. |
| Wrapping up | An explicitly invoked wrap-up turn is active. |
| Wrapped up | A wrap-up turn completed with no unresolved request while the process or thread remains open. |

The exact board order is `Ideas` → `Planning` → `Idle` → `Running` → `Needs you` → `Reviewing` → `Wrapping up` → `Wrapped up`.

The UI needs one lane per Board state, but the observer should retain the underlying facts separately:

- **lifecycle**: Idea, live Session, or ended/archived;
- **attention**: working, idle, or needs human input;
- **workflow phase**: planning, building, reviewing, or wrapping up.

Flattening those facts only at the board boundary avoids making “Needs you” erase that a session is reviewing, while still giving each card one obvious lane. `Needs you` always wins the visible lane; the underlying workflow phase remains a badge or detail. `Ideas` is separate because it has no session.

## Baseline before implementation

The following table records the classifier behaviour observed before the implementation change in PR #20. It is retained as assessment evidence, not as the current contract.

| Prior rule | Available evidence | Assessment |
| --- | --- | --- |
| Ideas | Agent Zen's local Idea record. | Exact and intentionally human-owned. |
| Running | A working turn with a native plan, or visible assistant/tool activity. | Good evidence for active work. A native plan means work is executing against a plan, not that Codex is in plan mode. |
| Planning / Idle | The prior classifier used this for a turn that had just started, a process between turns, or input pending. Pending input was then projected into the visible Needs you lane. | Conflated three materially different states. This was the main model defect. |
| Needs you | An unresolved native request on the root or a child. Owned sessions receive App Server requests; external sessions correlate persisted `request_user_input` calls and outputs. | Strong evidence. Keep the underlying workflow phase visible in details even when this lane wins. |
| Reviewing | The first meaningful line of the current user request explicitly invokes a recognised review command pattern or exact skill link. | Use this only while that explicitly invoked turn is active. On completion, fall back to Idle or Needs you. |
| Wrapping up | The first meaningful line explicitly invokes `$wrapup` or `/wrapup`. | Use this only while that explicitly invoked turn is active. |
| Wrapped up | No prior state existed. The observer already saw wrap-up invocation, turn completion, unresolved requests, process lifecycle, and thread archival. | Derive this when the wrap-up turn completes with no unresolved request; clear it on a new turn, and remove it when the process closes or the thread is archived. |

Starting a new turn clears the temporary Wrapped up state and classifies the resumed work from the new turn's evidence. Sessions leave the board when their owning Codex process no longer holds the rollout open or the thread is archived.

## Evidence used by the neutral-observer implementation

The neutral observer can become more accurate without asking agents to publish a separate state ledger:

1. **Plan mode is natively observable.** Current Codex rollouts contain `turn_context.payload.collaboration_mode.mode` and `thread_settings_applied.payload.thread_settings.collaboration_mode.mode`. Codex App Server also exposes `ThreadSettings.collaborationMode.mode`, whose values are `plan` and `default`. PR #20 parses these records into the canonical daemon snapshot.
2. **Idle is already exact enough.** A completed or aborted turn becomes idle while the owning process remains live. It should stop being mapped into Planning.
3. **Needs you already has request identity, with a bounded external-session limitation.** Owned sessions receive native App Server requests for user input and approvals. Persisted external-session parsing currently reconstructs `request_user_input` calls and matching outputs; command, file, or permission approvals are visible only when Codex persists equivalent request evidence.
4. **Review and wrap-up are currently sticky intent hints.** Keep explicit invocation recognition as a bounded observer signal, but end Reviewing and Wrapping up when their invoked turn completes.
5. **Wrap-up completion is derivable.** When the explicitly invoked wrap-up turn completes with no unresolved request, show Wrapped up until a new turn starts, process closure removes the Session, or thread archival removes it.

Hooks are therefore unnecessary for the core model. They could add richer semantics later, but should remain optional rather than becoming the source of truth.

## Implementation sequence

1. Add fixture-backed parsing for native collaboration mode and expose it in the canonical daemon snapshot.
2. Split Idle from Planning and classify Planning only while a turn is active and native `collaboration_mode.mode === "plan"`; completed or aborted turns become Idle while the process remains open.
3. Preserve attention and workflow phase as separate facts, then let Needs you win the visible lane while keeping the phase as detail.
4. Build regression fixtures from the known review and wrap-up misclassifications before changing those rules.
5. Add Wrapped up after a completed wrap-up turn with no unresolved request; clear it on a new turn, and remove the Session on process closure or thread archival.
6. Update the FAQ and ADR-0002 when the classifier contract changes.

## Accepted decisions

- **Needs you**: Needs you always wins the visible lane; keep the workflow phase as a badge or detail.
- **Reviewing**: Reviewing applies only while the explicitly invoked review turn is active; after completion, fall back to Idle or Needs you.
- **After wrap-up**: Move to Wrapped up after a wrap-up turn completes with no unresolved request; clear it when a new turn starts, and remove it when the process closes or thread is archived.

These decisions are the acceptance criteria for the separate classifier implementation.
