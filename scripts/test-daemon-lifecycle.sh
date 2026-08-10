#!/bin/zsh
set -euo pipefail

cli="${AGENT_ZEN_CLI:-$HOME/.local/bin/agent-zen}"
label="io.lucharo.agent-zen"
target="gui/$(id -u)/$label"

if [[ ! -x "$cli" ]]; then
  echo "Agent Zen CLI is not installed at $cli" >&2
  echo "Run: bun run install:cli" >&2
  exit 1
fi

initial_status="$("$cli" daemon status --json)"
initial_state="$(printf '%s' "$initial_status" | bun -e '
  const value = JSON.parse(await Bun.stdin.text())
  console.log([
    value.loaded ? "yes" : "no",
    value.healthy ? "yes" : "no",
    value.launchAtLogin ? "yes" : "no",
    value.plistPath,
  ].join("\t"))
')"
IFS=$'\t' read -r initial_loaded initial_healthy initial_launch_at_login initial_plist_path <<< "$initial_state"
initial_plist_exists=no
[[ -e "$initial_plist_path" ]] && initial_plist_exists=yes

if [[ "$initial_loaded" == yes && "$initial_healthy" != yes ]]; then
  echo "Refusing lifecycle test: Agent Zen is loaded but unhealthy" >&2
  exit 1
fi

restore_initial_state() {
  local test_exit=$?
  local restore_exit=0
  trap - EXIT
  set +e

  if [[ "$initial_loaded" == yes ]]; then
    "$cli" daemon start >/dev/null 2>&1
    if (( $? != 0 )); then
      echo "Failed to restore the initially running Agent Zen daemon" >&2
      restore_exit=1
    fi
  else
    "$cli" daemon stop >/dev/null 2>&1
    if (( $? != 0 )); then
      echo "Failed to restore Agent Zen to a stopped state" >&2
      restore_exit=1
    fi
    if [[ "$initial_launch_at_login" == yes ]]; then
      /bin/launchctl enable "$target"
      if (( $? != 0 )); then
        echo "Failed to restore Agent Zen launch-at-login" >&2
        restore_exit=1
      fi
    fi
  fi

  if [[ "$initial_plist_exists" == no && -e "$initial_plist_path" ]]; then
    /bin/rm -f -- "$initial_plist_path"
    if (( $? != 0 )); then
      echo "Failed to remove the plist created by the lifecycle test" >&2
      restore_exit=1
    fi
  fi

  (( restore_exit == 0 )) || exit "$restore_exit"
  exit "$test_exit"
}
trap restore_initial_state EXIT

"$cli" daemon start >/dev/null
running_status="$("$cli" daemon status --json)"
printf '%s' "$running_status" | bun -e '
  const value = JSON.parse(await Bun.stdin.text())
  if (!value.loaded || !value.healthy || !value.pid || !value.launchAtLogin) process.exit(1)
'

"$cli" daemon stop >/dev/null
if launchctl print "$target" >/dev/null 2>&1; then
  echo "Agent Zen remained loaded after daemon stop" >&2
  exit 1
fi
if curl -fsS --max-time 1 http://127.0.0.1:5274/api/health >/dev/null 2>&1; then
  echo "Agent Zen remained reachable after daemon stop" >&2
  exit 1
fi

"$cli" daemon start >/dev/null
pid_before="$("$cli" daemon status --json | bun -e 'console.log(JSON.parse(await Bun.stdin.text()).pid)')"
"$cli" daemon restart >/dev/null
pid_after="$("$cli" daemon status --json | bun -e 'console.log(JSON.parse(await Bun.stdin.text()).pid)')"
if [[ -z "$pid_before" || -z "$pid_after" || "$pid_before" == "$pid_after" ]]; then
  echo "Agent Zen restart did not replace the daemon process" >&2
  exit 1
fi

curl -fsS --max-time 2 http://127.0.0.1:5274/api/health | bun -e '
  const value = JSON.parse(await Bun.stdin.text())
  if (!value.connection || typeof value.generatedAt !== "string" || !value.runtime?.pid) process.exit(1)
'

echo "Agent Zen daemon lifecycle verified (pid $pid_before -> $pid_after)"
