# Agent Zen

A calm local board for Codex sessions. Two views — **Kanban** and **Ideas** — over
five stages: Ideas, Planning, Running, Reviewing, Wrapping up. No Done column;
finished sessions go to quiet history.

    bun install
    bun run bridge   # http://127.0.0.1:5274
    bun run dev      # http://127.0.0.1:5273
    bun run check    # typecheck + unit/server tests + production build
    bun run test:a11y

The bridge reads Codex's local thread index and rollout files without mutating
them, and owns one bundled `codex app-server --stdio` child for sessions launched
from Agent Zen. Existing Codex Desktop sessions are visible but read-only. Ideas
and the human-only Logbook stay in localStorage; registered projects, owned-thread
identity, and the optional focus limit live in `~/.agent-zen/settings.json`.

The implementation follows [the selected Codex-first visual direction](explorations/2026-08-05-codex-zen-directions/README.md). Accepted product, integration, Logbook, and prototype decisions are indexed in [docs/adr](docs/adr/README.md). The [QA index](qa/README.md) records the verified browser evidence.

## Live Codex connection

The rendered app is live. A loopback-only Bun bridge combines:

- read-only observation of `~/.codex/state_5.sqlite` and indexed rollout JSONL files;
- supported App Server control for sessions launched by Agent Zen;
- local Git discovery for project registration;
- a serialized launch gate for the optional focus limit.

ACP and hooks are not required. The board itself stays read-only: stage changes
come from Codex lifecycle and plan records, while control actions are available
only for sessions launched by the current Agent Zen bridge process. Restarting
the bridge returns persisted sessions to read-only. See [ADR-0002](docs/adr/0002-native-codex-connection.md).

In the browser, press `C` for centred quick capture. Browsers reserve `⌘N` for a
new window; a future native shell may map that same capture command to `⌘N`.
