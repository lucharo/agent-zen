#!/bin/zsh
set -euo pipefail

repo_root="${0:A:h:h}"
test_prefix="$(mktemp -d)"
cleanup() {
  rm -rf "$test_prefix"
}
trap cleanup EXIT

installed_dist="$test_prefix/share/agent-zen/dist"
installed_cli="$test_prefix/bin/agent-zen"
installed_server="$test_prefix/libexec/agent-zen/server.js"
mkdir -p "$installed_dist"
mkdir -p "${installed_cli:h}" "${installed_server:h}"
print -r -- 'previous release' > "$installed_dist/previous.txt"
print -r -- 'previous cli' > "$installed_cli"
print -r -- 'previous server' > "$installed_server"

interrupted_install() {
  local hook="$1"
  set +e
  env AGENT_ZEN_PREFIX="$test_prefix" "$hook=1" "$repo_root/scripts/install-cli.sh"
  local install_exit=$?
  set -e
  if [[ "$install_exit" -ne 143 ]]; then
    print -u2 -- "expected install interrupted at $hook to exit 143, got $install_exit"
    exit 1
  fi
  [[ -f "$installed_dist/previous.txt" ]]
  [[ "$(<"$installed_dist/previous.txt")" == 'previous release' ]]
  [[ "$(<"$installed_cli")" == 'previous cli' ]]
  [[ "$(<"$installed_server")" == 'previous server' ]]
  print -r -- "install interrupted at $hook left the previous release in place"
}

# Before anything is staged or backed up, and after the backups but before publishing.
interrupted_install AGENT_ZEN_TEST_INTERRUPT_BEFORE_STAGING
interrupted_install AGENT_ZEN_TEST_INTERRUPT_AFTER_ASSET_BACKUP
