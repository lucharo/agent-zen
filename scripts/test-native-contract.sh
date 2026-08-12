#!/bin/zsh
set -euo pipefail

repo_root="${0:A:h:h}"
temporary_dir="$(mktemp -d /private/tmp/agent-zen-native-test.XXXXXX)"

cleanup() {
  /bin/rm -rf -- "$temporary_dir"
}
trap cleanup EXIT INT TERM

cd "$repo_root"
mkdir -p "$temporary_dir/module-cache"
CLANG_MODULE_CACHE_PATH="$temporary_dir/module-cache" xcrun swiftc \
  -parse-as-library \
  -framework Carbon \
  native/BridgeProtocol.swift \
  native/GlobalShortcut.swift \
  qa/native/BridgeProtocolTests.swift \
  -o "$temporary_dir/bridge-protocol-tests"
"$temporary_dir/bridge-protocol-tests"
