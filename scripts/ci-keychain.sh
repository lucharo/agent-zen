#!/bin/zsh
# Put the Developer ID identities into a throwaway keychain for a CI release, or
# remove it again. .github/workflows/release.yml runs this; nothing here prints a secret.
#
#   scripts/ci-keychain.sh import   # needs RUNNER_TEMP and, base64-encoded:
#                                   #   DEVELOPER_ID_APPLICATION_P12, DEVELOPER_ID_INSTALLER_P12
#                                   # plus DEVELOPER_ID_P12_PASSWORD (the export password of both)
#   scripts/ci-keychain.sh delete
set -euo pipefail

keychain="${RUNNER_TEMP:?RUNNER_TEMP is not set}/agent-zen-release.keychain-db"

case "${1:-}" in
  import)
    : "${DEVELOPER_ID_P12_PASSWORD:?DEVELOPER_ID_P12_PASSWORD is empty}"
    keychain_password="$(openssl rand -base64 24)"
    security create-keychain -p "$keychain_password" "$keychain"
    security set-keychain-settings -lut 21600 "$keychain"
    security unlock-keychain -p "$keychain_password" "$keychain"
    for kind in APPLICATION INSTALLER; do
      p12_var="DEVELOPER_ID_${kind}_P12"
      if [[ -z "${(P)p12_var:-}" ]]; then
        echo "$p12_var is empty" >&2
        exit 1
      fi
      p12_file="$RUNNER_TEMP/developer-id-${kind:l}.p12"
      printf '%s' "${(P)p12_var}" | base64 --decode > "$p12_file"
      security import "$p12_file" -k "$keychain" -f pkcs12 -P "$DEVELOPER_ID_P12_PASSWORD" \
        -T /usr/bin/codesign -T /usr/bin/productsign -T /usr/bin/productbuild >/dev/null
      /bin/rm -f -- "$p12_file"
    done
    security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$keychain_password" "$keychain" >/dev/null
    # Search this keychain first, keeping the runner's own keychains after it.
    existing=(${(f)"$(security list-keychains -d user | sed -e 's/^ *"//' -e 's/"$//')"})
    security list-keychains -d user -s "$keychain" "${existing[@]:#$keychain}"
    # Names only: a certificate's common name is public.
    security find-identity -p basic "$keychain" | grep -E 'Developer ID (Application|Installer)' \
      || { echo "no Developer ID identity was imported" >&2; exit 1; }
    ;;
  delete)
    security delete-keychain "$keychain" 2>/dev/null || true
    ;;
  *)
    echo "usage: $0 import|delete" >&2
    exit 2
    ;;
esac
