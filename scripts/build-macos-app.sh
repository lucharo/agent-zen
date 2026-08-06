#!/bin/zsh
set -euo pipefail

repo_root="${0:A:h:h}"
app_dir="$repo_root/build/Agent Zen.app"
contents_dir="$app_dir/Contents"
macos_dir="$contents_dir/MacOS"
resources_dir="$contents_dir/Resources"

cd "$repo_root"
bun run build

if [[ -e "$app_dir" ]]; then
  /bin/rm -rf -- "$app_dir"
fi
mkdir -p "$macos_dir" "$resources_dir"

xcrun swiftc \
  -parse-as-library \
  -O \
  -framework AppKit \
  -framework WebKit \
  native/AgentZenApp.swift \
  -o "$macos_dir/Agent Zen"

bun build --compile server/index.ts --outfile "$resources_dir/agent-zen-bridge"
ditto dist "$resources_dir/dist"
cp native/Info.plist "$contents_dir/Info.plist"

signing_identity="${AGENT_ZEN_SIGNING_IDENTITY:-}"
if [[ -z "$signing_identity" ]]; then
  identities="$(security find-identity -v -p codesigning 2>/dev/null || true)"
  signing_identity="$(printf '%s\n' "$identities" | sed -n 's/.*"\(Developer ID Application:.*\)"/\1/p' | head -n 1)"
  if [[ -z "$signing_identity" ]]; then
    signing_identity="$(printf '%s\n' "$identities" | sed -n 's/.*"\(Apple Development:.*\)"/\1/p' | head -n 1)"
  fi
fi

if [[ -n "$signing_identity" ]]; then
  sign_flags=(--force --options runtime --sign "$signing_identity")
  if [[ "$signing_identity" == Developer\ ID\ Application:* ]]; then
    sign_flags+=(--timestamp)
  fi
  codesign "${sign_flags[@]}" --entitlements native/bridge.entitlements.plist "$resources_dir/agent-zen-bridge"
  codesign "${sign_flags[@]}" "$macos_dir/Agent Zen"
  codesign "${sign_flags[@]}" "$app_dir"
  echo "Signed with: $signing_identity"
else
  codesign --force --options runtime --sign - --entitlements native/bridge.entitlements.plist "$resources_dir/agent-zen-bridge"
  codesign --force --options runtime --sign - "$macos_dir/Agent Zen"
  codesign --force --options runtime --sign - "$app_dir"
  echo "Warning: no Apple signing identity found; created an ad-hoc build that managed Macs may block." >&2
fi

codesign --verify --deep --strict --verbose=2 "$app_dir"

echo "$app_dir"
