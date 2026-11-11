#!/bin/zsh
# Build, sign, package, notarise and staple a distributable Agent Zen release.
#
#   scripts/release-macos.sh [--skip-notarize] [--dmg] [--allow-development] [--publish]
#
# Produces build/release/AgentZen-<version>.pkg (a flat installer for
# a double-click install) and, with --dmg, AgentZen-<version>.dmg.
#
# Identities are auto-detected from the login keychain and can be pinned:
#   AGENT_ZEN_SIGNING_IDENTITY    "Developer ID Application: ..."
#   AGENT_ZEN_INSTALLER_IDENTITY  "Developer ID Installer: ..."
# --publish needs a clean checkout and a notarised build; it tags HEAD as v<version>
# (or requires the existing tag to be HEAD), uploads the PKG and DMG to that
# GitHub Release, and rewrites Casks/agent-zen.rb so `brew install --cask agent-zen` serves it.
# Notarisation uses one of:
#   NOTARY_PROFILE               keychain profile from `xcrun notarytool store-credentials`
#                                (default: lucharo)
#   ASC_KEY_PATH + ASC_KEY_ID + ASC_ISSUER_ID   App Store Connect API key
set -euo pipefail
setopt nullglob

repo_root="${0:A:h:h}"
app_name="Agent Zen"
artifact_name="AgentZen"
bundle_id="com.lucharo.agent-zen"
app_dir="$repo_root/build/$app_name.app"
release_dir="$repo_root/build/release"
skip_notarize=false
make_dmg=false
allow_development=false
publish=false
gh_repo="lucharo/agent-zen"
cask_token="agent-zen"

for arg in "$@"; do
  case "$arg" in
    --skip-notarize) skip_notarize=true ;;
    --dmg) make_dmg=true ;;
    --allow-development) allow_development=true ;;
    --publish) publish=true; make_dmg=true ;;
    -h|--help) sed -n '2,18p' "$0"; exit 0 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

cd "$repo_root"

if [[ "$publish" == true ]]; then
  if [[ "$skip_notarize" == true || "$allow_development" == true ]]; then
    echo "--publish needs a notarised Developer ID build; drop --skip-notarize and --allow-development." >&2
    exit 2
  fi
  if [[ -n "$(git status --porcelain)" ]]; then
    echo "--publish needs a clean checkout so the release tag matches the built source." >&2
    exit 2
  fi
  built_sha="$(git rev-parse HEAD)"
fi

team_id="7V3HZUL435"
# Only identities from this team.
identities="$(security find-identity -v -p codesigning 2>/dev/null | grep "($team_id)" || true)"
app_identity="${AGENT_ZEN_SIGNING_IDENTITY:-$(printf '%s\n' "$identities" | sed -n 's/.*"\(Developer ID Application:.*\)"/\1/p' | head -n 1)}"
installer_candidates="$(security find-identity -v 2>/dev/null | grep "($team_id)" || true)"
installer_identity="${AGENT_ZEN_INSTALLER_IDENTITY:-$(printf '%s\n' "$installer_candidates" | sed -n 's/.*"\(Developer ID Installer:.*\)"/\1/p' | head -n 1)}"
if [[ "$app_identity" != *"($team_id)"* && -n "$app_identity" ]] || [[ -n "$installer_identity" && "$installer_identity" != *"($team_id)"* ]]; then
  echo "Signing identities must belong to team $team_id." >&2
  exit 1
fi

if [[ "$app_identity" != Developer\ ID\ Application:* ]]; then
  if [[ "$allow_development" == true ]]; then
    app_identity="$(printf '%s\n' "$identities" | sed -n 's/.*"\(Apple Development:.*\)"/\1/p' | head -n 1)"
    if [[ -z "$app_identity" ]]; then
      echo "No Apple Development identity for team $team_id either; nothing to sign with." >&2
      exit 1
    fi
    skip_notarize=true
    echo "Warning: no Developer ID Application identity; building an Apple Development package that only this Mac trusts." >&2
  else
    echo "No 'Developer ID Application' identity in the keychain. Create one at" >&2
    echo "https://developer.apple.com/account/resources/certificates (see docs/macos-release.md)," >&2
    echo "or pass --allow-development for a local-only dry run." >&2
    exit 1
  fi
fi
if [[ -z "$installer_identity" ]]; then
  if [[ "$allow_development" == true ]]; then
    skip_notarize=true
    echo "Warning: no Developer ID Installer identity; the PKG will be unsigned and nothing is notarised." >&2
  else
    echo "No 'Developer ID Installer' identity in the keychain; the PKG cannot be signed for distribution." >&2
    exit 1
  fi
fi

notary_args=()
if [[ "$skip_notarize" == false ]]; then
  if [[ -n "${ASC_KEY_PATH:-}" ]]; then
    notary_args=(--key "$ASC_KEY_PATH" --key-id "${ASC_KEY_ID:?ASC_KEY_ID is required with ASC_KEY_PATH}" --issuer "${ASC_ISSUER_ID:?ASC_ISSUER_ID is required with ASC_KEY_PATH}")
  else
    notary_args=(--keychain-profile "${NOTARY_PROFILE:-lucharo}")
  fi
fi

notarize() {
  local artifact="$1"
  local staple_target="${2:-$1}"
  if [[ "$skip_notarize" == true ]]; then
    echo "Skipping notarisation for ${artifact:t}"
    return 0
  fi
  echo "Notarising ${artifact:t} ..."
  local log="$release_dir/${artifact:t}.notary.json"
  if ! xcrun notarytool submit "$artifact" "${notary_args[@]}" --wait --output-format json > "$log"; then
    echo "Notarisation failed; see $log" >&2
    exit 1
  fi
  if ! grep -q '"status" *: *"Accepted"' "$log"; then
    local id
    id="$(sed -n 's/.*"id" *: *"\([^"]*\)".*/\1/p' "$log" | head -n 1)"
    echo "Notarisation was not accepted (see $log). Fetch the log with:" >&2
    echo "  xcrun notarytool log $id ${notary_args[*]}" >&2
    exit 1
  fi
  xcrun stapler staple "$staple_target"
}

# 1. Signed app bundle (hardened runtime, secure timestamp).
AGENT_ZEN_SIGNING_IDENTITY="$app_identity" scripts/build-macos-app.sh
version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$app_dir/Contents/Info.plist")"
mkdir -p "$release_dir"
/bin/rm -f -- "$release_dir/$artifact_name-$version".{pkg,dmg,zip} "$release_dir/$artifact_name-$version-component.pkg" "$release_dir"/*.notary.json

# 2. Notarise the app (submitted as a zip) and staple the ticket into the bundle.
app_zip="$release_dir/$artifact_name-$version.zip"
ditto -c -k --keepParent "$app_dir" "$app_zip"
notarize "$app_zip" "$app_dir"
/bin/rm -f -- "$app_zip"

# 3. Flat PKG installing into /Applications. The CLI and daemon are not in the
#    bundle; they stay on the developer install path (scripts/install-cli.sh).
component_pkg="$release_dir/$artifact_name-$version-component.pkg"
# Stage an /Applications root and mark the bundle non-relocatable, so Installer
# never "updates" a stray copy elsewhere.
pkg_root="$(mktemp -d)"
mkdir -p "$pkg_root/Applications"
ditto "$app_dir" "$pkg_root/Applications/${app_dir:t}"
component_plist="$release_dir/component.plist"
pkgbuild --analyze --root "$pkg_root" "$component_plist" >/dev/null
/usr/libexec/PlistBuddy -c 'Set :0:BundleIsRelocatable false' "$component_plist"
pkgbuild \
  --root "$pkg_root" \
  --component-plist "$component_plist" \
  --install-location / \
  --identifier "$bundle_id.pkg" \
  --version "$version" \
  "$component_pkg"
/bin/rm -rf -- "$pkg_root" "$component_plist"

final_pkg="$release_dir/$artifact_name-$version.pkg"
product_args=(--package "$component_pkg")
if [[ -n "$installer_identity" ]]; then
  product_args+=(--sign "$installer_identity" --timestamp)
fi
productbuild "${product_args[@]}" "$final_pkg"
/bin/rm -f -- "$component_pkg"
notarize "$final_pkg"

# 4. Optional DMG for drag-to-Applications installs.
if [[ "$make_dmg" == true ]]; then
  staging="$(mktemp -d)"
  ditto "$app_dir" "$staging/$app_name.app"
  ln -s /Applications "$staging/Applications"
  final_dmg="$release_dir/$artifact_name-$version.dmg"
  # hdiutil under-sizes the image for the compiled bridge, so size it from the payload.
  dmg_mb=$(( $(du -sm "$staging" | cut -f1) * 3 / 2 + 20 ))
  hdiutil create -quiet -size "${dmg_mb}m" -volname "$app_name" -srcfolder "$staging" -ov -format UDZO "$final_dmg"
  /bin/rm -rf -- "$staging"
  codesign --force --timestamp --sign "$app_identity" "$final_dmg"
  notarize "$final_dmg"
fi

# 5. Verification: every check prints its verdict; a failure stops the release.
echo "--- verification"
codesign --verify --deep --strict --verbose=2 "$app_dir"
codesign -dvv "$app_dir" 2>&1 | grep -E '^(Authority=|TeamIdentifier=|Timestamp=)' | head -n 4
pkgutil --check-signature "$final_pkg" | head -n 3 || [[ "$allow_development" == true ]]
if [[ "$skip_notarize" == false ]]; then
  spctl -a -vv -t exec "$app_dir"
  spctl -a -vv -t install "$final_pkg"
  xcrun stapler validate "$final_pkg"
  if [[ "$make_dmg" == true ]]; then
    spctl -a -vv -t open --context context:primary-signature "$final_dmg"
  fi
else
  echo "spctl assessment skipped: unnotarised builds are rejected by Gatekeeper on other Macs."
fi

# 6. Optional publish: GitHub Release plus the Homebrew cask in this repo.
update_cask() {
  local cask="$1" new_version="$2" sha="$3"
  sed -i '' \
    -e "s/^  version \".*\"/  version \"$new_version\"/" \
    -e "s/^  sha256 \".*\"/  sha256 \"$sha\"/" \
    "$cask"
  grep -q "version \"$new_version\"" "$cask" && grep -q "sha256 \"$sha\"" "$cask"
}

if [[ "$publish" == true ]]; then
  tag="v$version"
  head_sha="$(git rev-parse HEAD)"
  if [[ "$head_sha" != "$built_sha" || -n "$(git status --porcelain)" ]]; then
    echo "The checkout changed during the build (built ${built_sha:0:12}, now ${head_sha:0:12}); not publishing." >&2
    exit 1
  fi
  if git ls-remote --exit-code --tags origin "refs/tags/$tag" >/dev/null 2>&1; then
    git fetch -q -f origin "refs/tags/${tag}:refs/tags/${tag}"
    tagged_sha="$(git rev-list -n 1 "$tag")"
    if [[ "$tagged_sha" != "$head_sha" ]]; then
      echo "Tag $tag already points at ${tagged_sha:0:12}, not HEAD ${head_sha:0:12}. Bump CFBundleShortVersionString for a new release." >&2
      exit 1
    fi
  else
    git tag -a "$tag" -m "$app_name $version" "$head_sha"
    if ! git push -q origin "refs/tags/$tag"; then
      git tag -d "$tag" >/dev/null
      echo "Could not push tag $tag; local tag removed so a retry starts clean." >&2
      exit 1
    fi
  fi
  if ! gh release view "$tag" --repo "$gh_repo" >/dev/null 2>&1; then
    gh release create "$tag" --repo "$gh_repo" --verify-tag --title "$app_name $version" --notes "Notarised Developer ID build of $head_sha. Install with the PKG, the DMG, or brew install --cask $cask_token (see docs/macos-release.md)."
  fi
  # The tag is proven to be HEAD, so replacing assets only ever rebuilds the same source.
  gh release upload "$tag" "$final_pkg" "$final_dmg" --repo "$gh_repo" --clobber
  dmg_sha="$(shasum -a 256 "$final_dmg" | cut -d" " -f1)"
  update_cask "Casks/$cask_token.rb" "$version" "$dmg_sha"
  echo "Published $tag; Casks/$cask_token.rb now points at $version. Commit it, then:"
  echo "  brew install --cask $cask_token"
fi

echo "--- artifacts"
ls -1 "$release_dir/$artifact_name-$version".*
