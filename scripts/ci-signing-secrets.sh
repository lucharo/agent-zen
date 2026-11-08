#!/bin/zsh
# Load the Developer ID identities and the App Store Connect notary key into the
# `release` environment secrets that .github/workflows/release.yml reads. Run it
# once on the Mac that holds the certificates, and again when one is renewed.
#
#   scripts/ci-signing-secrets.sh [--check] application.p12 installer.p12 AuthKey_<KEYID>.p8 <KEYID> <ISSUER-UUID>
#
# application.p12 / installer.p12: Keychain Access → login → My Certificates →
#   right-click "Developer ID Application: … (7V3HZUL435)" → Export → .p12, then the
#   same for "Developer ID Installer: … (7V3HZUL435)". Give both the same password.
#   One .p12 holding both identities may be passed twice.
# AuthKey_<KEYID>.p8: an App Store Connect API key with the Developer role
#   (https://appstoreconnect.apple.com/access/integrations/api); the issuer UUID
#   is at the top of that page.
# --check proves the files and the password and uploads nothing.
#
# The password is read without echo and travels by stdin; no secret reaches argv
# of a long-lived process, the terminal or a file other than the inputs.
set -euo pipefail

check_only=false
if [[ "${1:-}" == "--check" ]]; then
  check_only=true
  shift
fi
if (( $# != 5 )); then
  echo "usage: $0 [--check] application.p12 installer.p12 AuthKey_<KEYID>.p8 <KEYID> <ISSUER-UUID>" >&2
  exit 2
fi
app_p12="$1" installer_p12="$2" p8="$3" key_id="$4" issuer="$5"
repo="lucharo/agent-zen"
team_id="7V3HZUL435"
for file in "$app_p12" "$installer_p12" "$p8"; do
  [[ -f "$file" ]] || { echo "not a file: $file" >&2; exit 1; }
done
grep -q 'BEGIN PRIVATE KEY' "$p8" || { echo "$p8 is not an App Store Connect .p8 key" >&2; exit 1; }
[[ "$key_id" =~ '^[A-Z0-9]{10}$' ]] || { echo "key id should be 10 letters or digits, as in AuthKey_<KEYID>.p8" >&2; exit 1; }
[[ "$issuer" =~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' ]] || { echo "issuer should be a lowercase UUID" >&2; exit 1; }

read -rs "password?Password both .p12 files were exported with: "
echo

# Prove macOS itself can import each file and finds the identity in it: an
# OpenSSL decode alone has passed for files that macOS then refused.
scratch="$(mktemp -d)"
keychain="$scratch/check.keychain-db"
cleanup() {
  security delete-keychain "$keychain" 2>/dev/null || true
  /bin/rm -rf -- "$scratch"
}
trap cleanup EXIT
security create-keychain -p "" "$keychain"
for pair in "Application:$app_p12" "Installer:$installer_p12"; do
  kind="${pair%%:*}" file="${pair#*:}"
  if ! security import "$file" -k "$keychain" -f pkcs12 -P "$password" >/dev/null 2>&1; then
    echo "macOS could not import $file with that password." >&2
    exit 1
  fi
  if ! security find-identity -p basic "$keychain" | grep -q "Developer ID $kind: .*($team_id)"; then
    echo "$file holds no Developer ID $kind identity for team $team_id." >&2
    exit 1
  fi
done
echo "Both identities import and pair with their private keys."

if [[ "$check_only" == true ]]; then
  echo "--check: nothing uploaded."
  exit 0
fi

base64 -i "$app_p12" | gh secret set DEVELOPER_ID_APPLICATION_P12 --env release --repo "$repo"
base64 -i "$installer_p12" | gh secret set DEVELOPER_ID_INSTALLER_P12 --env release --repo "$repo"
printf '%s' "$password" | gh secret set DEVELOPER_ID_P12_PASSWORD --env release --repo "$repo"
gh secret set ASC_KEY_P8 --env release --repo "$repo" < "$p8"
printf '%s' "$key_id" | gh secret set ASC_KEY_ID --env release --repo "$repo"
printf '%s' "$issuer" | gh secret set ASC_ISSUER_ID --env release --repo "$repo"
gh secret list --env release --repo "$repo"
