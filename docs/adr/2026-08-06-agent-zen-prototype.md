# ADR: Agent Zen first working prototype

Date: 2026-08-06 · Status: accepted · Branch: `feat/codex-first-prototype`

Sources: `explorations/2026-08-05-codex-zen-directions/product-contract.md`,
`claude-opus-5-consultation.md`, `CZ3-kanban.png`, `CZ3-ideas.png`, `CZ1-kanban.png`, `CZ1-ideas.png`.

## Chosen design system

**CZ3 Native Ledger shell with CZ1 Quiet Canvas card and capture language.**

From CZ3: the single toolbar row, five equal columns on a tinted board, the
`Active N / M` stepper, native macOS control shapes. From CZ1: the card interior
(one plan line, one labelled timing line, a thin progress rule), the grouped
Ideas backlog, and the title-first capture sheet.

Rejected: CZ1 as the shell (its floating cards lose column identity at five
columns) and CZ3 as the card language (its dense metadata rows read as Jira).

**Answered grill.** *Why not a tab bar?* Two views is not a navigation problem;
`⌘1`/`⌘2` and a two-item switch cost less than a bar that invites a third
destination. *Why no Done column?* A finished session is history, not a card to
look at — it leaves the board and lives behind one quiet footer link.
*Why one Codex mark per column and none per card?* Four marks are a family; one
per card is a badge on every row. The mark is the real
`Codex.app/Contents/Resources/codexTemplate@2x.png`, tinted through a CSS mask,
held at 50% so it recedes.

## Navigation and view count

Exactly two primary views, Kanban and Ideas. Everything else is a sheet over the
board: quick capture, `⌘K` palette, detail, history. `Active N / M` counts **root
sessions in Planning or Running** — a child agent shares its parent's slot, and
Reviewing / Wrapping up wait on a human. That is why five session cards read
`Active 2 / 3`.

## Data ownership

| Read-only, from the agent | Owned by Agent Zen, persisted locally |
| --- | --- |
| Sessions, model, cwd, branch, worktree | Ideas and projects |
| Current plan + revision history | Stage overrides and semantic events |
| Review / wrapup signals, timings | Logbook notes, theme, view, filters |

The plan is **replaceable, not appendable**: `advancePlan` swaps the whole plan
and files the old revision in `planHistory`. There is no second ledger for an
agent to maintain. The Logbook is append-only by construction — the reducer has
one `add-logbook-note` action, no edit or delete, and stamps `author: 'human'`.

Stage derivation ladder, highest first: ended → off-board; human override;
latest semantic event; native inference (wrapup → review → plan). With zero
local state a session still lands in the right column.

## Responsive and theme behaviour

Below 1200px the five columns stop compressing and scroll sideways at a 268px
floor. System / Light / Dark, default System, explicit choice persisted to
`agent-zen.theme` and applied by a pre-paint script in `index.html` so a cold
reload never flashes the wrong palette.

## Integration contract and deliberate deferrals

`CodexSessionSource` is snapshot + subscribe with **no write methods** and no
hook transport. `createFixtureSessionSource` implements it; the record types in
`src/adapters/CodexSessionSource.ts` mirror the real shapes on disk
(`~/.codex/sessions/**/rollout-*.jsonl`, `session_index.jsonl`).

Deferred, and honest about it in the UI: the live app-server transport, `Launch
session`, and `Create GitHub issue` — each surfaces a "deferred" line rather
than a dead button.
