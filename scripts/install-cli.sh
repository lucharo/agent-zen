#!/bin/zsh
set -euo pipefail

repo_root="${0:A:h:h}"
prefix="${AGENT_ZEN_PREFIX:-$HOME/.local}"
build_dir="$repo_root/build/cli"
bin_dir="$prefix/bin"
libexec_dir="$prefix/libexec/agent-zen"
share_dir="$prefix/share/agent-zen/dist"
share_parent="${share_dir:h}"

cd "$repo_root"
bun run build
bun run typecheck:server
mkdir -p "$build_dir" "$bin_dir" "$libexec_dir" "$share_parent"

bun build --compile cli/index.ts --outfile "$build_dir/agent-zen"
bun build --compile --compile-exec-argv=--smol server/index.ts --outfile "$build_dir/agent-zen-server"

install_stage="$(mktemp -d "$share_parent/.install.XXXXXX")"
current_cli="$install_stage/current-agent-zen"
current_server="$install_stage/current-agent-zen-server"
current_assets="$install_stage/current-dist"
previous_cli="$install_stage/previous-agent-zen"
previous_server="$install_stage/previous-agent-zen-server"
previous_assets="$install_stage/previous-dist"
install_committed=0

cleanup_install() {
  local exit_code=$?
  if [[ "$install_committed" != 1 ]]; then
    if [[ -f "$previous_cli" ]]; then
      rm -f "$bin_dir/agent-zen"
      mv "$previous_cli" "$bin_dir/agent-zen" || true
    elif [[ ! -f "$current_cli" ]]; then
      rm -f "$bin_dir/agent-zen"
    fi
    if [[ -f "$previous_server" ]]; then
      rm -f "$libexec_dir/agent-zen-server"
      mv "$previous_server" "$libexec_dir/agent-zen-server" || true
    elif [[ ! -f "$current_server" ]]; then
      rm -f "$libexec_dir/agent-zen-server"
    fi
    if [[ -d "$previous_assets" ]]; then
      rm -rf "$share_dir"
      mv "$previous_assets" "$share_dir" || true
    elif [[ ! -d "$current_assets" ]]; then
      rm -rf "$share_dir"
    fi
  fi
  rm -rf "$install_stage"
  return "$exit_code"
}
trap cleanup_install EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

/usr/bin/install -m 0755 "$build_dir/agent-zen" "$current_cli"
/usr/bin/install -m 0755 "$build_dir/agent-zen-server" "$current_server"
/usr/bin/ditto "$repo_root/dist" "$current_assets"
if [[ -f "$bin_dir/agent-zen" ]]; then
  mv "$bin_dir/agent-zen" "$previous_cli"
fi
if [[ -f "$libexec_dir/agent-zen-server" ]]; then
  mv "$libexec_dir/agent-zen-server" "$previous_server"
fi
if [[ -d "$share_dir" ]]; then
  mv "$share_dir" "$previous_assets"
fi
if [[ "${AGENT_ZEN_TEST_INTERRUPT_AFTER_ASSET_BACKUP:-0}" == 1 ]]; then
  kill -TERM $$
fi
mv "$current_cli" "$bin_dir/agent-zen"
mv "$current_server" "$libexec_dir/agent-zen-server"
mv "$current_assets" "$share_dir"
install_committed=1
trap - EXIT
rm -rf "$install_stage"

echo "Installed Agent Zen CLI: $bin_dir/agent-zen"
echo "Start it with: agent-zen daemon start"
