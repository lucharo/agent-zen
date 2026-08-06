# Agent Zen

A calm local board for Codex sessions. Two views — **Kanban** and **Ideas** — over
five stages: Ideas, Planning, Running, Reviewing, Wrapping up. No Done column;
finished sessions go to quiet history.

    bun install
    bun run dev      # http://localhost:5273
    bun run check    # typecheck + tests + production build

Session data is read-only and arrives through the typed `CodexSessionSource`
(`src/adapters/`), currently fixture-backed. Ideas, projects, stage overrides and
the human-only Logbook are owned by Agent Zen and persisted to localStorage.

The implementation follows [the selected Codex-first visual direction](explorations/2026-08-05-codex-zen-directions/README.md). Accepted product, integration, Logbook, and prototype decisions are indexed in [docs/adr](docs/adr/README.md). Browser evidence lives in `qa/`.
