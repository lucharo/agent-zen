# ADR-0005: Read-only board and quiet settings

- Status: Accepted
- Date: 2026-08-06

## Outcome

The Kanban remains an agent-authored projection. Human configuration moves into one centred Settings surface, and project registration uses a separate quiet discovery dialog.

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
- Collapse Ideas horizontally into a narrow left rail.
- Give Planning, Running, Reviewing, and Wrapping up distinct stage symbols in their column headings.
- Keep project discovery behind its own source interface; the prototype uses truthful sample candidates.
- Show the current connection mode prominently so fixture data cannot be mistaken for live Codex state.

## Consequences

- A live launch controller must consult the same focus-limit function used by the UI before calling `turn/start`.
- Project discovery will move from fixtures to a local bridge that scans configured roots and reads git remotes, with optional `gh` enrichment.
- Stage correction happens by correcting the Codex adapter’s observations, not by dragging a card.
