#!/bin/zsh
set -euo pipefail

repo_root="${0:A:h:h}"
port="${AGENT_ZEN_PARENT_TEST_PORT:-5296}"
missing_parent_pid="99999999"
temporary_dir="$(mktemp -d /private/tmp/agent-zen-parent-test.XXXXXX)"
bridge_pid=""

cleanup() {
  if [[ -n "$bridge_pid" ]] && kill -0 "$bridge_pid" 2>/dev/null; then
    kill -TERM "$bridge_pid"
    wait "$bridge_pid" 2>/dev/null || true
  fi
  /bin/rm -rf -- "$temporary_dir"
}
trap cleanup EXIT INT TERM

if kill -0 "$missing_parent_pid" 2>/dev/null; then
  echo "Expected parent test PID $missing_parent_pid to be absent." >&2
  exit 1
fi
if curl -fsS "http://127.0.0.1:$port/" >/dev/null 2>&1; then
  echo "Port $port is already in use." >&2
  exit 1
fi

cd "$repo_root"
bun build --target=bun --minify server/index.ts \
  --outfile "$temporary_dir/agent-zen-bridge.js" >/dev/null

AGENT_ZEN_PORT="$port" \
AGENT_ZEN_DIST_DIR="$repo_root/dist" \
AGENT_ZEN_FRONTEND_BUILD_ID="parent-lifecycle-test" \
AGENT_ZEN_UPSTREAM_BRIDGE_URL="http://127.0.0.1:5274" \
AGENT_ZEN_PARENT_PID="$missing_parent_pid" \
  bun --smol "$temporary_dir/agent-zen-bridge.js" >"$temporary_dir/bridge.log" 2>&1 &
bridge_pid="$!"

started=0
for attempt in {1..20}; do
  if curl -fsS "http://127.0.0.1:$port/" >/dev/null 2>&1; then
    started=1
    break
  fi
  if ! kill -0 "$bridge_pid" 2>/dev/null; then
    break
  fi
  sleep 0.05
done
if (( started == 0 )); then
  echo "Packaged bridge did not become ready before the parent check." >&2
  sed -n '1,80p' "$temporary_dir/bridge.log" >&2
  exit 1
fi

for attempt in {1..40}; do
  if ! kill -0 "$bridge_pid" 2>/dev/null; then
    wait "$bridge_pid"
    bridge_pid=""
    echo "Packaged bridge exited after its native parent disappeared."
    exit 0
  fi
  sleep 0.05
done

echo "Packaged bridge stayed alive after its native parent disappeared." >&2
exit 1
