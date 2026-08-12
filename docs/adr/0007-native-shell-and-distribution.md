# ADR-0007: Native shell and distribution ladder

- Status: Accepted, personal development build verified; notarisation pending
- Date: 2026-08-06
- Updated: 2026-08-12

## Outcome

Agent Zen has a small AppKit and WKWebView shell with genuine macOS menu commands, a menu-bar companion, and an embedded local bridge. An Apple Development-signed build now runs on the personal Mac. 

## Decision

- `Option-Space` opens a capture-only surface globally by default. The menu-bar submenu can change it to `Control-Space`, `Option-Command-Space`, or Off. `Command-N` opens that surface while Agent Zen is active; `Command-,` opens Settings.
- The menu-bar icon visualises Running, Reviewing, and Wrapping up as three compact bars. Its menu names all three counts explicitly, then offers Open, Quick Capture, Settings, shortcut selection, and Quit.
- Menu status refreshes are single-flight and schedule the next read only after the previous read finishes. Concurrent HTTP snapshot requests share one server-side observer pass, while `/api/health` remains independent so a busy daemon is not mistaken for an unavailable one and duplicated by the packaged fallback.
- The native shell always serves its bundled frontend from loopback port 5275, with an exact build identity, so Quick Capture capability and origin-scoped Ideas and Logbook data stay stable. When the compatible launch-at-login daemon is healthy on port 5274, the packaged process forwards API requests to it without starting a second Codex child; otherwise that same port-5275 process owns the bridge itself. Vite development continues to use port 5274 directly.
- The packaged port-5275 process watches the AppKit parent that launched it and shuts down if that parent disappears, so a native crash cannot leave an orphan occupying the frontend port.
- The native entry point creates an accessory `NSApplication`, assigns and retains its delegate, then enters the event loop without a window or WebView. It becomes a foreground app only after the user chooses Open or Quick Capture. A compiling `@main` delegate class alone starts AppKit without wiring that delegate.
- The shell supplies an explicit launch path containing common user-local locations and passes the first executable `codex` path to the bridge, because Finder-launched apps do not inherit the login-shell PATH.
- Closing hides one retained AppKit window, releases its WebView after the close event, and never deallocates the window during AppKit's close animation.
- `bun run build:macos` compiles the web assets, Swift shell, and Bun bridge into `build/Agent Zen.app`.
- Signing automatically prefers Developer ID Application, then Apple Development. The Bun bridge is signed first with its JavaScriptCore JIT entitlements, followed by the AppKit executable and outer bundle; the final bundle is verified. With no identity, the script creates an ad-hoc build and prints a warning.
- The distribution sequence is: Apple-signed personal-Mac test, hardened Developer ID build, notarisation, then optional Mac App Store work.

## Verified boundary

Launch is not verified there because endpoint security blocks the ad-hoc-signed publisher before application code runs. On 2026-08-07 the bundle passed `codesign --verify --deep --strict`, while that Mac still reported zero valid identities.

On 2026-08-11 the personal Mac built and installed version 0.1.0 with an Apple Development identity. The cold installed build passed strict nested-signature verification, connected its packaged bridge to Codex on port 5275, rendered the 1240×820 session window, and exposed the menu-bar companion plus New Idea, Settings, and Quit commands to macOS Accessibility. `spctl -a` still rejects this development build as a distributable app, correctly: the keychain has Apple Development and Apple Distribution identities but no `Developer ID Application` identity. GitHub issue #13 continues to track that certificate, hardened archive, notarisation, stapling, and release notes.

On 2026-08-12 the shell was changed to launch quietly, defer WebView creation until an explicit user action, retain its NSWindow across hide/reopen cycles, and keep one build-identified frontend origin while proxying a compatible daemon. Two EXC_BAD_ACCESS crash reports identified stale-window access and close-animation teardown as the prior failure modes. Native contract tests now cover bridge and frontend compatibility, stage counting, shortcut presets, and same-surface reuse without launching or foregrounding the app. A headless proxy canary served the bundled UI and daemon snapshot with zero child processes of its own, and a separate lifecycle canary proved the packaged bridge exits when its native parent is gone.

The same-day performance regression showed six overlapping menu requests reading one 125 MB rollout at once. A red/green handler regression now proves those reads coalesce, and the native contract proves a second refresh cannot begin while one is active. An isolated six-request burst required connected health and a live Codex child, then kept health responsive inside the shell's 350 ms reuse deadline; the bridge peaked at 180 MiB and fell to 49 MiB after ten seconds, while bridge plus Codex peaked at 252 MiB and fell to 94 MiB. The gate does not launch the GUI.

An Apple Developer account is necessary but not sufficient: a certificate and its private key must be installed on the build Mac. A notarised Developer ID build is the preferred first distribution because Mac App Store sandboxing would require a separate access design for Codex stores, repositories, Git, and subprocess control.

## Consequences

- The web app remains fully functional and advertises `C`, not `Command-N`, for capture.
- The 2026-08-11 foreground shell was verified on the personal Mac. The current accessory-launch and retained-window changes have build, contract-test, layout-test, and review evidence only; a future cold installed test must not be replaced by compilation.
- Menu-bar and window UI share one web application and one bridge, avoiding a second state model.
- Mac App Store packaging is deliberately postponed until the local-file and process permission contract is explicit.
