# ADR-0008: CLI-managed local daemon

- Status: Accepted
- Date: 2026-08-10

## Outcome

Agent Zen ships an `agent-zen` CLI and one launch-at-login macOS service on `http://localhost:5274/`. The service serves the production web app and Codex bridge together, so using Agent Zen does not require keeping Vite or a terminal open.

## Decision

- Use the familiar `agent-zen daemon start|status|restart|stop` lifecycle used by Kenn Forge and RoboRev. Add `daemon logs`, `daemon run`, and top-level `open` because the daemon's main interface is a local web app.
- `bun run install:cli` builds standalone Bun executables, installs the CLI under `~/.local/bin`, the server under `~/.local/libexec/agent-zen`, and web assets under `~/.local/share/agent-zen`.
- `daemon start` writes and validates `~/Library/LaunchAgents/io.lucharo.agent-zen.plist`, enables it, bootstraps it, and waits for the real `/api/health` endpoint.
- The LaunchAgent uses `RunAtLoad` and `KeepAlive`. It receives explicit `HOME`, `PATH`, Codex binary, port and distribution paths because launchd does not inherit the login shell.
- `daemon stop` unloads and disables the service but leaves the generated plist in place. Start and stop are idempotent.
- Stop waits up to 15 seconds for launchd to remove the service identity and for the old serving PID to leave the health endpoint. It never force-kills a PID that may have been reused.
- The health response carries the serving process id. Start, status and restart accept the endpoint as managed only when that id matches launchd's current process. They refuse to kill or silently adopt an unmanaged process on the port.
- Status reports launchd state, authenticated HTTP health and Codex connectivity separately, including a machine-readable `--json` form.
- Runtime state and logs stay under `~/.agent-zen`. The service remains loopback-only and reuses the existing Host and Origin checks.

## Consequences

- There is one stable local endpoint instead of separate bridge and frontend processes.
- Replacing the installed executable or web assets requires `agent-zen daemon restart`.
- The daemon is currently macOS-specific because its supervisor is launchd. The foreground `daemon run` command keeps the server boundary portable for a later Linux service adapter.
- The native AppKit shell and the browser reuse the same bridge implementation and data model; neither gets a second session ledger.

## Rejected alternatives

- **Keep using development terminals:** easy to start, but produced duplicate ports, stale browser entries and an app that disappeared when the session ended.
- **Put the LaunchAgent in personal dotfiles:** suitable for one machine, but wrong for a tool intended to install its own local service for other users.
- **Force-kill after a short timeout:** launchd sometimes takes slightly over five seconds to retire the service. A longer bounded graceful wait is safer than killing an unauthenticated PID.
