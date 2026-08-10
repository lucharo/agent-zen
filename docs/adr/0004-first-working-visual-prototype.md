# ADR-0004: First working visual prototype

- Status: Accepted prototype; history footer superseded
- Date: 2026-08-06

## Outcome

The first working prototype implements the **CZ3 Native Ledger shell with CZ1 Quiet Canvas card and capture language** as a local React application.

Sources: `explorations/2026-08-05-codex-zen-directions/product-contract.md`, `claude-opus-5-consultation.md`, `CZ3-kanban.png`, `CZ3-ideas.png`, `CZ1-kanban.png`, and `CZ1-ideas.png`.

## Answered grill

- **Why not a tab bar?** Two views are a switch, not a navigation system. `Cmd+1`, `Cmd+2`, and two visible controls cost less than chrome that invites more destinations.
- **Why no Done column?** A finished session is not current attention and leaves the board. The prototype's quiet history footer was later removed because a bounded observer sample is not a trustworthy history total.
- **Why one Codex mark per session column?** Four column marks establish the family; repeating it on every card becomes badge noise.
- **What does Active count?** Root sessions in Planning / Idle or Running. Child agents share the parent's slot; Reviewing and Wrapping up have released active capacity.
- **How narrow can the board become?** Below 1200px, columns retain a 268px floor and scroll horizontally rather than compressing their content.
- **What is deliberately deferred?** The live Codex transport, launching a session, and creating a GitHub issue. The prototype labels those boundaries rather than presenting dead controls as complete.

## Decision

- Use one toolbar row, five equal columns, native macOS control shapes, and a lightly tinted canvas.
- Use one plan line, one labelled timing line, and one thin progress rule on Running cards.
- Keep quick capture title-first with one compact Tab-ordered field row and `Keep as idea` as the default.
- Treat sheets as secondary surfaces: quick capture, command palette, detail, and history. They do not become primary views.
- Keep agent-derived session state read-only behind `CodexSessionSource`.
- Persist ideas, projects, focus-limit settings, theme, filters, and human-only Logbook notes locally. Session placement remains agent-derived.
- Support System, Light, and Dark with a pre-paint theme script so cold reload does not flash the wrong palette.

## Consequences

- The fixture adapter must demonstrate continuously replaced native plans without resetting the current-turn clock.
- The live adapter must combine app-server inventory/control with read-only cross-process rollout observation as described in ADR-0002.
- Browser evidence must include an exact desktop viewport, a real 900x800 narrow viewport, and cold-reload checks for local state.

## Rejected alternatives

- **CZ1 as the shell:** its floating-card composition loses column identity across five stages.
- **CZ3 card density:** its unlabelled metadata rows read like a compressed tracker.
- **A static screenshot recreation:** cannot prove keyboard behavior, persistence, stage derivation, or a replaceable native plan.
