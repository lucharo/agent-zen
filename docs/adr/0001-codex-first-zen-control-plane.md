# ADR-0001: Codex-first zen control plane

- Status: Accepted
- Date: 2026-08-06

## Outcome

Agent Zen presents a quiet local control plane with exactly two primary views: Sessions and Ideas. Sessions has two projections, a stage Kanban and a compact grid. The first implementation targets Codex only and uses the **CZ3 Native Ledger shell with CZ1 Quiet Canvas card and capture language**.

## Answered grill

- **What problem are we solving?** Preserve the focus and boundedness of paper while retaining visibility and control over many local agent sessions.
- **Why a Kanban at all?** It makes capacity, stage, and the next available slot visible. It is one view of the control plane, not the whole product.
- **What is deliberately bounded?** Primary navigation, active sessions, visible cards, card metadata, and the number of agent systems integrated initially.
- **What is the durable tracker?** GitHub remains the durable home for committed issues and project work; Agent Zen owns local ideas and session control.
- **What are we not building?** A Jira replacement, CI dashboard, telemetry wall, or general project-management suite.

## Decision

- Provide only `Sessions` and `Ideas` as primary views.
- Let Sessions switch between a stage Kanban and a compact grid without changing the underlying session state.
- Use five board stages: `Ideas`, `Planning / Idle`, `Running`, `Reviewing`, and `Wrapping up`.
- Keep completed work off the active board rather than in a Done column. Any future history surface needs explicit pagination and retention semantics.
- Put the Codex mark in the column title, never on every card.
- Show only title, project, native plan step, labelled timing, and exceptional state on cards. Put model, repository, branch, worktree, and session identity in accessible progressive disclosure.
- Use a Things-style keyboard-first quick capture with no launch by default.
- Register local repositories as projects and retain GitHub linkage, branch, and worktree awareness.
- Target Codex first behind a modular session-source boundary.

## Consequences

- The active board stays cognitively small even when durable history or the Ideas backlog grows.
- WIP limits must be first-class product state, not a decorative counter.
- Secondary capabilities must fit filters, command actions, or detail surfaces rather than becoming new tabs.

## Rejected alternatives

- **Paper only:** excellent for focus, but loses sessions created outside the page and cannot control them.
- **Generic Kanban:** tracks tickets but cannot read or steer native agent sessions.
- **Kenn Forge-style workspace dashboard:** useful repository awareness, but too dense for the intended control surface.
- **Codex and Claude together immediately:** increases integration ambiguity before the Codex contract is proven.
