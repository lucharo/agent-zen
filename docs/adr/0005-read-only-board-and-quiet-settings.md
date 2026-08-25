# ADR-0005: Read-only board and quiet settings

- Status: Accepted
- Date: 2026-08-06

## Outcome

The Sessions views remain an agent-authored projection. Human configuration moves into one centred Settings surface, and optional project registration uses a separate quiet discovery dialog.

## Answered grill

- **Can a human move a session card?** No. Manual placement creates a second truth that can disagree with Codex.
- **What does the focus limit constrain?** Only launching a new root session. It never stops existing work; child agents share a parent slot; Reviewing and Wrapping up release capacity.
- **What is the default?** Disabled. The toolbar says `Limit off` until the user explicitly enables it.
- **Why a project registry?** Local checkout paths let Agent Zen match sessions by `cwd`; detected GitHub remotes add durable issue and repository identity.
- **Why not copy Kenn Forge onboarding?** Its searchable repository discovery and “start small” language are useful. Its five-step workspace journey is outside Agent Zen’s scope.
- **Why centred task details?** A bounded card over blur preserves the board as context and matches Taskflow’s useful modal pattern better than a full-height side inspector.

## Decision

- Add `⌘,` for Settings and expose Settings through the command palette and focus-limit control.
- Replace three theme targets with one `System → Light → Dark` cycling control.
- Persist theme, current view, layout, grouping, card detail, Ideas folding, project filter, and focus policy in the local bridge settings file at `~/.agent-zen/settings.json`.
- Collapse Ideas horizontally into a narrow left rail.
- Give Planning, Idle, Running, Needs you, Reviewing, Wrapping up, and Wrapped up distinct symbols in their column headings; let Settings keep collapsed lanes as rails or hide them.
- Keep project discovery behind its own source interface; the live bridge scans configured local roots and reads Git remotes and branches.
- Automatically register a discovered Git project when it owns a visible active session. Manual registration remains for inactive repositories the user wants as launch targets.
- Show the current connection status in Settings, with an explicit error if the live bridge is unavailable.

## Consequences

- The launch controller consults the same focus-limit function used by the UI before calling `thread/start` or `turn/start`, and serializes competing launch requests so two callers cannot claim the final slot.
- Project discovery remains local and Git-based. An active repository becomes visible, filterable, and launch-authorised without a separate onboarding step.
- Stage correction happens by correcting the Codex adapter’s observations, not by dragging a card.
- Existing browser preferences migrate into the bridge once. Browser storage remains only for a project cache used by Ideas, human Ideas and Logbook data, plus a theme paint cache; it is not the live settings authority. Agent Zen-owned app-server identity remains connection-scoped and is not persisted.
