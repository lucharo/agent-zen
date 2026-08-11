# Agent Zen

Agent Zen is a calm, local view of the Codex sessions already running on your Mac. It answers a few practical questions: what is active, what project does it belong to, what is the agent doing now, and which sessions actually need your attention?

It exists because pen and paper is surprisingly good at managing agent work. A small page has edges. It makes you choose. The trouble starts after launching the sessions: the paper no longer knows which ones are still alive, which plan changed, or where the worktree went. Agent Zen keeps the useful constraint and adds back that missing visibility.

This is not a throughput dashboard. It is an active shelf for choosing what to care about.

![Agent Zen session grid](qa/2026-08-07-active-process-discovery/live-title-grid-1440x900.png)

## What it does

- Shows one card per root Codex session, with child agents contained inside it.
- Reads native Codex goals, plans, turns, session names, projects, branches and worktrees without asking the agent to maintain another ledger.
- Projects sessions into Planning / Idle, Running, Reviewing and Wrapping up. Running means the turn is progressing; Idle and Needs you return ordinary work to the first column.
- Offers a compact grid when the Kanban columns are too much.
- Keeps Ideas as a human-owned space before planning, plus a private Logbook attached to each session. Cards can show those comments without mixing them into Codex state.
- Leaves the session board read-only. Agent Zen observes Codex; it does not become a second workflow authority.

Finished or archived sessions leave the active board. There is deliberately no Done column competing for attention.

## Install the CLI and daemon

Agent Zen ships as one local app on `http://localhost:5274/`. The CLI installs a user LaunchAgent, keeps the service alive, and starts it again at login.

```sh
bun install
bun run install:cli
agent-zen daemon start
agent-zen open
```

The installer puts the CLI in `~/.local/bin/agent-zen`. If that directory is not on your `PATH`, call it by its full path.

```sh
agent-zen daemon status
agent-zen daemon status --json
agent-zen sessions
agent-zen sessions --json
agent-zen explain <session-id-or-title-prefix>
agent-zen daemon logs --follow
agent-zen daemon restart
agent-zen daemon stop
```

`daemon start` and `daemon stop` are idempotent. Start installs and enables `io.lucharo.agent-zen`; stop unloads and disables it. The service binds only to loopback. Its LaunchAgent lives at `~/Library/LaunchAgents/io.lucharo.agent-zen.plist`, with logs and settings under `~/.agent-zen/`.

`sessions` and `explain` read the same classified daemon snapshot as the board. Both include the current explicit goal, when one exists. `explain` also reports the stable stage reason, so a CLI check and the visible column cannot silently use different classifiers.

After updating the repository, run `bun run install:cli` again followed by `agent-zen daemon restart`.

## Where the idea came from

The starting point was not another project-management system. It was the experience of running many agent sessions, opening another one whenever a thought appeared, and gradually losing the shape of the work. A handwritten list fixed the attention problem but could not follow the live sessions. Agent Zen grew out of that gap.

Several tools informed it:

- [Kenn Forge](https://github.com/kenn-io/forge), previously called Middleman, showed how a local daemon can discover repositories, worktrees and ongoing work. Agent Zen borrows that local-first operational shape, not Forge's much broader interface.
- [Vibe Kanban](https://github.com/BloopAI/vibe-kanban) showed the appeal of keeping agent sessions visible and controllable from one place. Agent Zen is intentionally quieter and optimises for bounded attention rather than maximum parallel throughput.
- [agentsview](https://github.com/wesm/agentsview) demonstrated how useful the agent's own local session records can be when gathered into a dependable browser. Agent Zen uses the same general principle but focuses on the small set of sessions that are active now.
- [RoboRev](https://github.com/roborev-dev/roborev) and the Kenn/Wes CLI family influenced the familiar `daemon start|status|restart|stop` contract.
- [Kanban Code](https://github.com/langwatch/kanban-code), Things 3 and the local [Taskflow](https://github.com/lucharo/taskflow) experiment contributed smaller ideas: native-feeling session controls, fast keyboard capture, project assignment and centred detail sheets.

These are influences, not dependencies or claims of feature parity. The product boundary came from the paper workflow: unlimited capture, a deliberately small active horizon, and no obligation to react to every session just because it is visible.

## How the Codex connection works

The loopback Bun service combines two native sources:

1. It observes active Codex processes, `~/.codex/state_5.sqlite`, and the matching rollout JSONL files. That is how sessions started in Codex Desktop, terminals or worktrees remain visible.
2. It owns one bundled `codex app-server --stdio` child for supported control of sessions launched through this Agent Zen process.

ACP and hooks are not required. Existing sessions remain read-only. Goals and plans are optional: a successful Codex goal-tool result becomes the session's explicit goal, while substantive work can be Running before an agent creates a plan. Every native plan replacement is reflected without creating a second task database. See [ADR-0002](docs/adr/0002-native-codex-connection.md) for the exact stage and ownership contract.

The browser refreshes the snapshot every second. UI preferences, registered projects and the optional focus limit live in `~/.agent-zen/settings.json`. Ideas and the human-only Logbook remain local browser data.

## Native macOS shell

The repository also contains a small AppKit and WKWebView shell with real `Command-N`, `Command-,` and menu-bar commands:

```sh
bun run build:macos
```

The browser and daemon are the working distribution today. The next native step is an Apple-signed personal-Mac test, followed by Developer ID signing and notarisation. See [ADR-0007](docs/adr/0007-native-shell-and-distribution.md).

## Development

```sh
bun run bridge       # source bridge on http://127.0.0.1:5274
bun run dev          # Vite on http://127.0.0.1:5273
bun run check        # types, unit/server/CLI tests, production build
bun run test:daemon  # installed launchd start/stop/restart lifecycle
bun run test:a11y    # Playwright and axe
```

Stop the installed daemon before running the source bridge on the same port.

The accepted product decisions are indexed in [docs/adr](docs/adr/README.md). The [FAQ](docs/faq/README.md) explains stages, refresh, storage, daemon persistence, native requests, worktree identity and focus limits. The [QA index](qa/README.md) records browser evidence rather than treating a successful build as proof of the UI.
