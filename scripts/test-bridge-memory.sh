#!/bin/zsh
set -euo pipefail

repo_root="${0:A:h:h}"
port="${AGENT_ZEN_MEMORY_TEST_PORT:-5289}"
bridge_limit_kib="${AGENT_ZEN_BRIDGE_MEMORY_LIMIT_KIB:-196608}"
cohort_limit_kib="${AGENT_ZEN_MEMORY_LIMIT_KIB:-286720}"
temporary_dir="$(mktemp -d /private/tmp/agent-zen-memory.XXXXXX)"
bridge_pid=""
health_response="$temporary_dir/health.json"

cleanup() {
  if [[ -n "$bridge_pid" ]] && kill -0 "$bridge_pid" 2>/dev/null; then
    kill -TERM "$bridge_pid"
    wait "$bridge_pid" 2>/dev/null || true
  fi
  /bin/rm -rf -- "$temporary_dir"
}
trap cleanup EXIT INT TERM

if curl -fsS "http://127.0.0.1:$port/api/health" >/dev/null 2>&1; then
  echo "Port $port already serves an Agent Zen bridge." >&2
  exit 1
fi

cd "$repo_root"
bun build --compile --compile-exec-argv=--smol server/index.ts --outfile "$temporary_dir/agent-zen-bridge" >/dev/null

AGENT_ZEN_PORT="$port" \
AGENT_ZEN_DIST_DIR="$repo_root/dist" \
  "$temporary_dir/agent-zen-bridge" >"$temporary_dir/bridge.log" 2>&1 &
bridge_pid="$!"

health_reports_connected_codex() {
  [[ -s "$1" ]] || return 1
  bun -e '
    const value = await Bun.file(process.argv[1]).json()
    process.exit(value.connection?.connected === true ? 0 : 1)
  ' "$1" >/dev/null 2>&1
}

codex_child_pid() {
  ps -axo pid=,ppid= | awk -v root="$bridge_pid" '$2 == root { print $1; exit }'
}

for attempt in {1..80}; do
  if curl -fsS "http://127.0.0.1:$port/api/health" -o "$health_response" 2>/dev/null \
    && health_reports_connected_codex "$health_response"; then
    break
  fi
  if ! kill -0 "$bridge_pid" 2>/dev/null; then
    sed -n '1,80p' "$temporary_dir/bridge.log" >&2
    exit 1
  fi
  sleep 0.1
done
if ! health_reports_connected_codex "$health_response"; then
  echo "Agent Zen bridge never reported a connected Codex app-server." >&2
  sed -n '1,80p' "$temporary_dir/bridge.log" >&2
  exit 1
fi
if [[ -z "$(codex_child_pid)" ]]; then
  echo "Agent Zen reported Codex connected without a live child process." >&2
  exit 1
fi

peak_bridge_kib=0
peak_cohort_kib=0
peak_breakdown=""
sample_cohort() {
  bridge_kib="$(ps -p "$bridge_pid" -o rss= | awk '{ print $1 + 0 }')"
  cohort_kib="$(ps -axo pid=,ppid=,rss= | awk -v root="$bridge_pid" '
    $1 == root { total += $3 }
    $2 == root { total += $3 }
    END { print total + 0 }
  ')"
  if (( bridge_kib > peak_bridge_kib )); then
    peak_bridge_kib="$bridge_kib"
  fi
  if (( cohort_kib > peak_cohort_kib )); then
    peak_cohort_kib="$cohort_kib"
    peak_breakdown="$(ps -axo pid=,ppid=,rss=,comm= | awk -v root="$bridge_pid" '
      $1 == root || $2 == root { print }
    ')"
  fi
}

snapshot_pids=()
for snapshot_number in {1..6}; do
  curl -fsS "http://127.0.0.1:$port/api/snapshot" >/dev/null &
  snapshot_pids+=("$!")
done

sample_cohort
running_at_health=0
for snapshot_pid in "${snapshot_pids[@]}"; do
  if kill -0 "$snapshot_pid" 2>/dev/null; then
    running_at_health="$((running_at_health + 1))"
  fi
done
if (( running_at_health == 0 )); then
  echo "Snapshot burst finished before the health-overlap check could run." >&2
  exit 1
fi

burst_health_response="$temporary_dir/burst-health.json"
curl -fsS --max-time 0.35 "http://127.0.0.1:$port/api/health" -o "$burst_health_response" &
health_pid="$!"
while kill -0 "$health_pid" 2>/dev/null; do
  sample_cohort
  sleep 0.02
done
if ! wait "$health_pid"; then
  echo "Agent Zen health endpoint stalled during concurrent snapshot requests." >&2
  exit 1
fi
if ! health_reports_connected_codex "$burst_health_response"; then
  echo "Agent Zen lost its Codex connection during the snapshot burst." >&2
  exit 1
fi
if [[ -z "$(codex_child_pid)" ]]; then
  echo "Codex child process disappeared during the snapshot burst." >&2
  exit 1
fi

while true; do
  running_snapshots=0
  for snapshot_pid in "${snapshot_pids[@]}"; do
    if kill -0 "$snapshot_pid" 2>/dev/null; then
      running_snapshots="$((running_snapshots + 1))"
    fi
  done
  if (( running_snapshots == 0 )); then
    break
  fi
  sample_cohort
  sleep 0.02
done
for snapshot_pid in "${snapshot_pids[@]}"; do
  wait "$snapshot_pid"
done
sample_cohort

for snapshot_number in {1..4}; do
  curl -fsS "http://127.0.0.1:$port/api/snapshot" >/dev/null &
  snapshot_pid="$!"
  while kill -0 "$snapshot_pid" 2>/dev/null; do
    sample_cohort
    sleep 0.02
  done
  wait "$snapshot_pid"
  sample_cohort
  sleep 1
done

peak_bridge_mib="$(( (peak_bridge_kib + 1023) / 1024 ))"
peak_cohort_mib="$(( (peak_cohort_kib + 1023) / 1024 ))"
bridge_limit_mib="$(( bridge_limit_kib / 1024 ))"
cohort_limit_mib="$(( cohort_limit_kib / 1024 ))"
sleep 10
steady_bridge_kib="$(ps -p "$bridge_pid" -o rss= | awk '{ print $1 + 0 }')"
steady_cohort_kib="$(ps -axo pid=,ppid=,rss= | awk -v root="$bridge_pid" '
  $1 == root { total += $3 }
  $2 == root { total += $3 }
  END { print total + 0 }
')"
steady_bridge_mib="$(( (steady_bridge_kib + 1023) / 1024 ))"
steady_cohort_mib="$(( (steady_cohort_kib + 1023) / 1024 ))"
echo "Agent Zen bridge peak while snapshotting: ${peak_bridge_mib} MiB (limit: ${bridge_limit_mib} MiB)"
echo "Bridge + Codex cohort peak: ${peak_cohort_mib} MiB across a six-request burst and four follow-ups (limit: ${cohort_limit_mib} MiB)"
echo "Bridge 10 seconds after the burst: ${steady_bridge_mib} MiB; bridge + Codex: ${steady_cohort_mib} MiB"
if (( peak_bridge_kib > bridge_limit_kib || peak_cohort_kib > cohort_limit_kib )); then
  echo "$peak_breakdown" >&2
  exit 1
fi
