# macOS release: signed, notarised PKG for other Macs

Releases run in GitHub Actions: bump the version, merge, push the tag, and
`.github/workflows/release.yml` does the rest (see
[Release from a tag push](#release-from-a-tag-push)). The local command below
is the same script, for a Mac that holds the certificates.

`bun run release:macos` builds `build/release/AgentZen-<version>.pkg`, a flat
installer signed with Developer ID, notarised by Apple and stapled. Add `--dmg`
for a drag-to-Applications disk image as well. Any Mac other than the build
machine needs this route, because Gatekeeper rejects Apple Development and
ad-hoc signatures.

## One-time setup on the release Mac

1. **Developer ID certificates.** In the Apple Developer account, create
   `Developer ID Application` and `Developer ID Installer` certificates
   (https://developer.apple.com/account/resources/certificates, Account Holder
   only). Generate the CSRs with Keychain Access or `openssl req -new -newkey
   rsa:2048 -nodes`, upload them, download both `.cer` files and double-click
   them so they pair with the private keys in the login keychain. Check:

   ```bash
   security find-identity -v -p codesigning   # lists "Developer ID Application: ..."
   security find-identity -v                  # also lists "Developer ID Installer: ..."
   ```

2. **Notary credentials.** Store an App Store Connect API key once:

   ```bash
   xcrun notarytool store-credentials lucharo \
     --key ~/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8 \
     --key-id <KEY_ID> --issuer <ISSUER_ID>
   ```

   The issuer ID is on https://appstoreconnect.apple.com/access/integrations/api.
   Set `NOTARY_PROFILE` to use a different profile name, or pass
   `ASC_KEY_PATH`, `ASC_KEY_ID` and `ASC_ISSUER_ID` instead of a profile.

## What the release command does

1. Builds `build/Agent Zen.app` with `scripts/build-macos-app.sh`: the Bun
   bridge is signed first with its JavaScriptCore JIT entitlements, then the
   AppKit executable and the bundle, all with hardened runtime and a secure
   timestamp.
2. Notarises the app and staples the ticket into the bundle.
3. Builds a component package that installs `Agent Zen.app` into
   `/Applications`, wraps it with `productbuild`, signs it with Developer ID
   Installer, notarises and staples.
4. Optionally builds, signs, notarises and staples a DMG.
5. Verifies with `codesign --verify --deep --strict`, `pkgutil --check-signature`,
   `spctl -a -t exec`, `spctl -a -t install` and `stapler validate`.

`--skip-notarize` builds and signs without submitting (Gatekeeper on other Macs
will still refuse it). `--allow-development` falls back to the Apple Development
identity for a local dry run of the packaging.

## Homebrew install

The repository doubles as a Homebrew tap: `Casks/agent-zen.rb` points at the DMG
attached to the GitHub Release for the current version.

```bash
brew tap lucharo/agent-zen https://github.com/lucharo/agent-zen.git
brew trust --tap lucharo/agent-zen   # Homebrew 6 and later load no third-party tap it has not been told to trust
brew install --cask agent-zen
brew upgrade --cask agent-zen        # after a new release
```

Publishing a release is one flag on the release command:

```bash
bun run release:macos -- --publish
```

It creates GitHub Release `v<version>` if missing, uploads the PKG and DMG,
rewrites the cask's `version` and `sha256`, and prints the install
command. Commit the cask change so `brew upgrade` sees it.

## Release from a tag push

1. Bump the version in `native/Info.plist` (`CFBundleShortVersionString` and
   `CFBundleVersion`) and `package.json`; the workflow refuses a tag that
   disagrees with them. Merge that to `main`.
2. `git tag -a v<version> -m "Agent Zen <version>" && git push origin v<version>`.

The `release` job builds and tests, imports both Developer ID identities into a
throwaway keychain, runs `scripts/release-macos.sh --publish` with the App Store
Connect key (sign, notarise and staple the app, PKG and DMG, then upload them to
the GitHub Release), commits the cask's new `version` and `sha256` to `main`,
and deletes the keychain and key. It runs in the `release` environment, which
only `v*` tags may deploy to, with no approval step: the tag push is the
release. A pull request that changes the release machinery runs the same job
as a dry run with throwaway identities, no notarisation and nothing published.

One-time setup, on the Mac that holds the certificates:

1. Keychain Access → login → My Certificates: export `Developer ID
   Application: … (7V3HZUL435)` and `Developer ID Installer: … (7V3HZUL435)`
   as `.p12` files with the same password.
2. Create an App Store Connect API key with the Developer role at
   https://appstoreconnect.apple.com/access/integrations/api, download its
   `AuthKey_<KEY_ID>.p8` and note the issuer ID at the top of that page.
3. `scripts/ci-signing-secrets.sh application.p12 installer.p12 AuthKey_<KEY_ID>.p8 <KEY_ID> <ISSUER_ID>`.
   It asks for the `.p12` password without echo, proves macOS imports both
   identities, and sets the six secrets of the `release` environment:
   `DEVELOPER_ID_APPLICATION_P12`, `DEVELOPER_ID_INSTALLER_P12` (base64),
   `DEVELOPER_ID_P12_PASSWORD`, `ASC_KEY_P8`, `ASC_KEY_ID`, `ASC_ISSUER_ID`.
   Add `--check` to validate without uploading.

## Managed paths and lifecycle

| Item | Path | Owner |
| --- | --- | --- |
| App bundle, menu-bar companion, embedded bridge on port 5275 | `/Applications/Agent Zen.app` | PKG |
| Ideas and Logbook | browser storage of the serving origin | user, never touched by the PKG |
| Developer CLI and launch-at-login daemon | `~/.local` via `scripts/install-cli.sh` | user, not in the PKG |

The PKG ships only the app. The CLI and daemon remain a developer install so
the package needs no managed background item; the app owns its bridge process
from launch until it quits, forwarding to a compatible daemon on 5274 when one
is running.

- **Install**: `sudo installer -pkg AgentZen-<version>.pkg -target /`. First launch starts the embedded bridge and finds
  `codex` on the explicit launch path.
- **Upgrade**: install the newer PKG over the old one; quit Agent Zen first so
  the running bridge is replaced cleanly. Browser-owned data is untouched
  because the serving origin does not change.
- **Rollback**: install the previous PKG. Data lives in the browser store, so
  the only compatibility concern is the bridge protocol version, which the app
  checks on launch.
- **Reinstall**: installing the same version is idempotent.
- **Uninstall**: quit Agent Zen and remove `/Applications/Agent Zen.app`.
  Browser-owned data stays until the site data is cleared.
