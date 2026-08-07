# ADR-0007: Native shell and distribution ladder


- Date: 2026-08-06
- Updated: 2026-08-07

## Outcome

Agent Zen has a small AppKit and WKWebView shell with genuine macOS menu commands, a menu-bar companion, and an embedded local bridge. 

## Decision

- `Command-N` opens centred New Idea capture; `Command-,` opens Settings.
- The menu-bar item reports active and visible session counts and offers Open, New Idea, Settings, and Quit.
- The native shell launches and owns one packaged Agent Zen bridge on loopback port 5275. The web client uses the serving origin in packaged mode and port 5274 during Vite development.
- The shell supplies an explicit launch path containing common user-local locations and passes the first executable `codex` path to the bridge, because Finder-launched apps do not inherit the login-shell PATH.
- `bun run build:macos` compiles the web assets, Swift shell, and Bun bridge into `build/Agent Zen.app`.
- Signing automatically prefers Developer ID Application, then Apple Development. The Bun bridge is signed first with its JavaScriptCore JIT entitlements, followed by the AppKit executable and outer bundle; the final bundle is verified. With no identity, the script creates an ad-hoc build and prints a warning.
- The distribution sequence is: Apple-signed personal-Mac test, hardened Developer ID build, notarisation, then optional Mac App Store work.

## Verified boundary

Launch is not verified there because endpoint security blocks the ad-hoc-signed publisher before application code runs. On 2026-08-07 the bundle passed `codesign --verify --deep --strict`, while `security find-identity -v -p codesigning` still reported zero valid identities. GitHub issue #13 tracks signed and notarised distribution.

An Apple Developer account is necessary but not sufficient: a certificate and its private key must be installed on the build Mac. A notarised Developer ID build is the preferred first distribution because Mac App Store sandboxing would require a separate access design for Codex stores, repositories, Git, and subprocess control.

## Consequences

- The web app remains fully functional and advertises `C`, not `Command-N`, for capture.
- Native runtime behaviour must be validated on the personal Mac after signing; compilation is not a substitute for that test.
- Menu-bar and window UI share one web application and one bridge, avoiding a second state model.
- Mac App Store packaging is deliberately postponed until the local-file and process permission contract is explicit.
