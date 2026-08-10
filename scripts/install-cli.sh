#!/bin/zsh
set -euo pipefail

repo_root="${0:A:h:h}"
prefix="${AGENT_ZEN_PREFIX:-$HOME/.local}"
build_dir="$repo_root/build/cli"
bin_dir="$prefix/bin"
libexec_dir="$prefix/libexec/agent-zen"
share_dir="$prefix/share/agent-zen/dist"

cd "$repo_root"
bun run build
bun run typecheck:server
mkdir -p "$build_dir" "$bin_dir" "$libexec_dir" "$share_dir"

bun build --compile cli/index.ts --outfile "$build_dir/agent-zen"
bun build --compile server/index.ts --outfile "$build_dir/agent-zen-server"

/usr/bin/install -m 0755 "$build_dir/agent-zen" "$bin_dir/agent-zen"
/usr/bin/install -m 0755 "$build_dir/agent-zen-server" "$libexec_dir/agent-zen-server"
/usr/bin/ditto "$repo_root/dist" "$share_dir"

echo "Installed Agent Zen CLI: $bin_dir/agent-zen"
echo "Start it with: agent-zen daemon start"
