# macOS release: signed, notarised PKG for other Macs

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
brew trust --tap lucharo/agent-zen   # Homebrew 6 loads no third-party tap it has not been told to trust
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
