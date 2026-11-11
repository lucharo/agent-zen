#!/bin/zsh
set -euo pipefail

repo_root="${0:A:h:h}"
app_dir="$repo_root/build/Agent Zen.app"
contents_dir="$app_dir/Contents"
macos_dir="$contents_dir/MacOS"
resources_dir="$contents_dir/Resources"
native_configuration="$repo_root/build/NativeBuildConfiguration.swift"

cd "$repo_root"
bun run build

if [[ -e "$app_dir" ]]; then
  /bin/rm -rf -- "$app_dir"
fi
mkdir -p "$macos_dir" "$resources_dir"

frontend_build_id="$(shasum -a 256 dist/index.html | awk '{ print $1 }')"
if [[ -z "$frontend_build_id" ]]; then
  echo "Could not calculate the packaged frontend identity" >&2
  exit 1
fi
printf '%s\n' "$frontend_build_id" > "$resources_dir/frontend-build-id"

bridge_protocol_version="$(sed -n 's/^export const BRIDGE_PROTOCOL_VERSION = \([0-9][0-9]*\)$/\1/p' src/bridge/types.ts)"
if [[ -z "$bridge_protocol_version" ]]; then
  echo "Could not read BRIDGE_PROTOCOL_VERSION from src/bridge/types.ts" >&2
  exit 1
fi
printf 'let agentZenBridgeProtocolVersion = %s\n' "$bridge_protocol_version" > "$native_configuration"

xcrun swiftc \
  -parse-as-library \
  -O \
  -framework AppKit \
  -framework Carbon \
  -framework WebKit \
  native/AgentZenApp.swift \
  native/BridgeProtocol.swift \
  native/BunLocator.swift \
  native/GlobalShortcut.swift \
  "$native_configuration" \
  -o "$macos_dir/Agent Zen"

# The bridge ships as a JavaScript bundle that the user's Bun runs (the cask depends on it),
# not as a compiled binary carrying its own copy of the runtime.
bun build --target=bun --minify server/index.ts --outfile "$resources_dir/agent-zen-bridge.js"
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
  codesign "${sign_flags[@]}" "$macos_dir/Agent Zen"
  codesign "${sign_flags[@]}" "$app_dir"
  echo "Signed with: $signing_identity"
else
  codesign --force --options runtime --sign - "$macos_dir/Agent Zen"
  codesign --force --options runtime --sign - "$app_dir"
  echo "Warning: no Apple signing identity found; created an ad-hoc build that managed Macs may block." >&2
fi

codesign --verify --deep --strict --verbose=2 "$app_dir"

echo "$app_dir"
