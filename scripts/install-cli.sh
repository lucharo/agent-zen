#!/bin/zsh
set -euo pipefail

# Installs the CLI as small JavaScript bundles run by the user's Bun:
#   <prefix>/bin/agent-zen                    a launcher that finds Bun
#   <prefix>/libexec/agent-zen/cli.js         the CLI
#   <prefix>/libexec/agent-zen/server.js      the daemon's bridge
#   <prefix>/share/agent-zen/dist             the web app
# Each part is swapped in only after all three are staged, and an interrupted
# install puts the previous release back.

repo_root="${0:A:h:h}"
prefix="${AGENT_ZEN_PREFIX:-$HOME/.local}"
build_dir="$repo_root/build/cli"
bin_dir="$prefix/bin"
libexec_dir="$prefix/libexec/agent-zen"
libexec_parent="${libexec_dir:h}"
share_dir="$prefix/share/agent-zen/dist"
share_parent="${share_dir:h}"

cd "$repo_root"
bun run build
bun run typecheck:server
mkdir -p "$build_dir" "$bin_dir" "$libexec_parent" "$share_parent"

bun build --target=bun --minify cli/index.ts --outfile "$build_dir/cli.js"
bun build --target=bun --minify server/index.ts --outfile "$build_dir/server.js"

install_stage="$(mktemp -d "$share_parent/.install.XXXXXX")"
current_cli="$install_stage/current-agent-zen"
current_libexec="$install_stage/current-libexec"
current_assets="$install_stage/current-dist"
previous_cli="$install_stage/previous-agent-zen"
previous_libexec="$install_stage/previous-libexec"
previous_assets="$install_stage/previous-dist"
install_committed=0
published_cli=0
published_libexec=0
published_assets=0

# Undo only what this run changed: restore a destination it backed up, remove one it
# published without a backup, and leave everything else exactly as it was.
restore_part() {
  local destination="$1" previous="$2" published="$3"
  if [[ -e "$previous" ]]; then
    rm -rf "$destination"
    mv "$previous" "$destination" || true
  elif [[ "$published" == 1 ]]; then
    rm -rf "$destination"
  fi
}

cleanup_install() {
  local exit_code=$?
  if [[ "$install_committed" != 1 ]]; then
    restore_part "$bin_dir/agent-zen" "$previous_cli" "$published_cli"
    restore_part "$libexec_dir" "$previous_libexec" "$published_libexec"
    restore_part "$share_dir" "$previous_assets" "$published_assets"
  fi
  rm -rf "$install_stage"
  return "$exit_code"
}
trap cleanup_install EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
if [[ "${AGENT_ZEN_TEST_INTERRUPT_BEFORE_STAGING:-0}" == 1 ]]; then
  kill -TERM $$
fi

cat > "$current_cli" <<'LAUNCHER'
#!/bin/sh
# Agent Zen CLI launcher: runs the bundled CLI with the Bun already on this Mac.
here="$(cd "$(dirname "$0")/.." && pwd)"
for bun in /opt/homebrew/bin/bun /usr/local/bin/bun "$HOME/.bun/bin/bun" "$(command -v bun 2>/dev/null)"; do
  if [ -n "$bun" ] && [ -x "$bun" ]; then
    exec "$bun" "$here/libexec/agent-zen/cli.js" "$@"
  fi
done
echo "Agent Zen needs Bun: brew install bun" >&2
exit 1
LAUNCHER
chmod 0755 "$current_cli"
mkdir -p "$current_libexec"
/usr/bin/install -m 0644 "$build_dir/cli.js" "$current_libexec/cli.js"
/usr/bin/install -m 0644 "$build_dir/server.js" "$current_libexec/server.js"
/usr/bin/ditto "$repo_root/dist" "$current_assets"
if [[ -f "$bin_dir/agent-zen" ]]; then
  mv "$bin_dir/agent-zen" "$previous_cli"
fi
if [[ -d "$libexec_dir" ]]; then
  mv "$libexec_dir" "$previous_libexec"
fi
if [[ -d "$share_dir" ]]; then
  mv "$share_dir" "$previous_assets"
fi
if [[ "${AGENT_ZEN_TEST_INTERRUPT_AFTER_ASSET_BACKUP:-0}" == 1 ]]; then
  kill -TERM $$
fi
mv "$current_cli" "$bin_dir/agent-zen"
published_cli=1
mv "$current_libexec" "$libexec_dir"
published_libexec=1
mv "$current_assets" "$share_dir"
published_assets=1
install_committed=1
trap - EXIT
rm -rf "$install_stage"

echo "Installed Agent Zen CLI: $bin_dir/agent-zen"
echo "Start it with: agent-zen daemon start"
