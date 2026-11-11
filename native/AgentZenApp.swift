import AppKit
import WebKit

private final class LockedFlag: @unchecked Sendable {
    private let lock = NSLock()
    private var value = false

    func set(_ nextValue: Bool) {
        lock.lock()
        value = nextValue
        lock.unlock()
    }

    func get() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return value
    }
}

@main
enum AgentZenMain {
    static func main() {
        let application = NSApplication.shared
        application.setActivationPolicy(.accessory)
        let delegate = AgentZenApp()
        application.delegate = delegate
        application.run()
        withExtendedLifetime(delegate) {}
    }
}

final class AgentZenApp: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate {
    private let daemonPort = 5274
    private let bundledBridgePort = 5275
    private var activePort = 5275
    private var window: NSWindow?
    private var webView: WKWebView?
    private var windowSurface: WindowSurface?
    private var requestedWebSurface: WindowSurface?
    private var loadedWebSurface: WindowSurface?
    private var statusItem: NSStatusItem!
    private var statusSummaryItem: NSMenuItem!
    private var runningStatusItem: NSMenuItem!
    private var reviewingStatusItem: NSMenuItem!
    private var wrappingStatusItem: NSMenuItem!
    private var shortcutMenuItem: NSMenuItem!
    private var shortcutItems: [QuickCaptureShortcutPreset: NSMenuItem] = [:]
    private var statusTimer: Timer?
    private var bridgeProcess: Process?
    private var bridgeLog: FileHandle?
    private var bridgeReady = false
    private var pendingNativeEvent: String?
    private var launchFailureMessage: String?
    private let shortcutDefaultsKey = "quickCaptureShortcutPreset"
    private let statusRefreshGate = SingleFlightGate()
    private let statusRefreshInterval: TimeInterval = 5
    private lazy var frontendBuildId: String? = {
        guard
            let url = Bundle.main.resourceURL?.appendingPathComponent("frontend-build-id"),
            let value = try? String(contentsOf: url, encoding: .utf8)
                .trimmingCharacters(in: .whitespacesAndNewlines),
            !value.isEmpty
        else { return nil }
        return value
    }()
    private lazy var shortcutRegistry = GlobalShortcutRegistry { [weak self] in
        self?.showQuickCapture()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        configureMenus()
        configureStatusItem()
        configureGlobalShortcut()
        startBridgeAndLoad()
    }

    func applicationWillTerminate(_ notification: Notification) {
        window?.delegate = nil
        if let process = bridgeProcess, process.isRunning {
            process.terminate()
        }
        try? bridgeLog?.close()
        statusTimer?.invalidate()
        shortcutRegistry.unregister()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showMainWindow()
        return true
    }

    private func configureWindow() {
        guard window == nil else { return }
        let nextWindow = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1240, height: 820),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        nextWindow.title = "Agent Zen"
        nextWindow.titleVisibility = .hidden
        nextWindow.minSize = NSSize(width: 820, height: 620)
        nextWindow.titlebarAppearsTransparent = true
        nextWindow.isReleasedWhenClosed = false
        nextWindow.delegate = self
        nextWindow.center()
        window = nextWindow
    }

    private func configureWebView(in targetWindow: NSWindow) {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        let nextWebView = WKWebView(frame: .zero, configuration: configuration)
        nextWebView.customUserAgent = "AgentZenNative/1.0"
        nextWebView.navigationDelegate = self
        targetWindow.contentView = nextWebView
        webView = nextWebView
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        guard sender === window else { return true }
        hideWindowAndReleaseWebView()
        return false
    }

    private func hideWindowAndReleaseWebView() {
        window?.orderOut(nil)
        NSApp.setActivationPolicy(.accessory)
        let discardedWebView = webView
        webView = nil
        windowSurface = nil
        requestedWebSurface = nil
        loadedWebSurface = nil
        DispatchQueue.main.async {
            discardedWebView?.stopLoading()
            discardedWebView?.navigationDelegate = nil
            if self.window?.contentView === discardedWebView {
                self.window?.contentView = NSView(frame: self.window?.contentView?.bounds ?? .zero)
            }
        }
    }

    private func configureStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        if let button = statusItem.button {
            button.image = stageBarsImage(running: 0, reviewing: 0, wrapping: 0)
            button.toolTip = "Agent Zen"
        }

        let menu = NSMenu(title: "Agent Zen")
        statusSummaryItem = menu.addItem(withTitle: "Connecting to your agents…", action: nil, keyEquivalent: "")
        statusSummaryItem.isEnabled = false
        runningStatusItem = addStageStatusItem(
            to: menu,
            title: "Running",
            symbol: "play.circle",
            accessibilityDescription: "Running sessions"
        )
        reviewingStatusItem = addStageStatusItem(
            to: menu,
            title: "Reviewing",
            symbol: "eye",
            accessibilityDescription: "Sessions in review"
        )
        wrappingStatusItem = addStageStatusItem(
            to: menu,
            title: "Wrapping up",
            symbol: "shippingbox",
            accessibilityDescription: "Sessions wrapping up"
        )
        menu.addItem(.separator())
        let openItem = menu.addItem(withTitle: "Open Agent Zen", action: #selector(showWindow), keyEquivalent: "")
        openItem.target = self
        let newIdeaItem = menu.addItem(withTitle: "Quick Capture", action: #selector(openNewIdea), keyEquivalent: "n")
        newIdeaItem.target = self
        let settingsItem = menu.addItem(withTitle: "Settings…", action: #selector(openSettings), keyEquivalent: ",")
        settingsItem.target = self
        shortcutMenuItem = NSMenuItem(title: "Quick Capture Shortcut", action: nil, keyEquivalent: "")
        let shortcutMenu = NSMenu(title: "Quick Capture Shortcut")
        for preset in QuickCaptureShortcutPreset.allCases {
            let item = shortcutMenu.addItem(
                withTitle: preset.title,
                action: #selector(selectQuickCaptureShortcut(_:)),
                keyEquivalent: ""
            )
            item.target = self
            item.representedObject = preset.rawValue
            shortcutItems[preset] = item
        }
        shortcutMenuItem.submenu = shortcutMenu
        menu.addItem(shortcutMenuItem)
        menu.addItem(.separator())
        menu.addItem(withTitle: "Quit Agent Zen", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        statusItem.menu = menu
    }

    private func addStageStatusItem(
        to menu: NSMenu,
        title: String,
        symbol: String,
        accessibilityDescription: String
    ) -> NSMenuItem {
        let item = menu.addItem(withTitle: "\(title)  0", action: nil, keyEquivalent: "")
        item.image = NSImage(systemSymbolName: symbol, accessibilityDescription: accessibilityDescription)
        item.isEnabled = false
        return item
    }

    private func configureMenus() {
        let mainMenu = NSMenu()
        NSApp.mainMenu = mainMenu

        let appMenuItem = NSMenuItem()
        mainMenu.addItem(appMenuItem)
        let appMenu = NSMenu(title: "Agent Zen")
        appMenuItem.submenu = appMenu
        appMenu.addItem(withTitle: "About Agent Zen", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        let settingsItem = appMenu.addItem(withTitle: "Settings…", action: #selector(openSettings), keyEquivalent: ",")
        settingsItem.target = self
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit Agent Zen", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")

        let fileMenuItem = NSMenuItem()
        mainMenu.addItem(fileMenuItem)
        let fileMenu = NSMenu(title: "File")
        fileMenuItem.submenu = fileMenu
        let newIdeaItem = fileMenu.addItem(withTitle: "New Idea", action: #selector(openNewIdea), keyEquivalent: "n")
        newIdeaItem.target = self
        fileMenu.addItem(.separator())
        fileMenu.addItem(withTitle: "Close Window", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")

        let viewMenuItem = NSMenuItem()
        mainMenu.addItem(viewMenuItem)
        let viewMenu = NSMenu(title: "View")
        viewMenuItem.submenu = viewMenu
        let reloadItem = viewMenu.addItem(withTitle: "Reload", action: #selector(reload), keyEquivalent: "r")
        reloadItem.target = self
    }

    private func startBridgeAndLoad() {
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }
            for _ in 0..<12 {
                if self.bridgeIsHealthy(on: self.daemonPort) {
                    DispatchQueue.main.async { [weak self] in
                        guard let self else { return }
                        self.startBundledBridgeAndLoad(upstreamPort: self.daemonPort)
                    }
                    return
                }
                Thread.sleep(forTimeInterval: 0.15)
            }
            DispatchQueue.main.async { [weak self] in
                self?.startBundledBridgeAndLoad(upstreamPort: nil)
            }
        }
    }

    private func startBundledBridgeAndLoad(upstreamPort: Int?) {
        guard let frontendBuildId else {
            showLaunchFailure("The packaged Agent Zen frontend identity is missing.")
            return
        }
        activePort = bundledBridgePort
        let expectedApiPort = upstreamPort ?? bundledBridgePort
        if bridgeIsHealthy(
            on: bundledBridgePort,
            expectedFrontendBuildId: frontendBuildId,
            expectedFrontendApiPort: expectedApiPort
        ) {
            loadApplication()
            return
        }

        do {
            try launchBridge(upstreamPort: upstreamPort, frontendBuildId: frontendBuildId)
        } catch BridgeLaunchError.bunMissing {
            showLaunchFailure(bunMissingMessage)
            showBunMissingAlert()
            return
        } catch {
            showLaunchFailure("Could not start the local agent bridge: \(error.localizedDescription)")
            return
        }

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }
            for _ in 0..<80 {
                if self.bridgeIsHealthy(
                    on: self.bundledBridgePort,
                    expectedFrontendBuildId: frontendBuildId,
                    expectedFrontendApiPort: expectedApiPort
                ) {
                    DispatchQueue.main.async { [weak self] in self?.loadApplication() }
                    return
                }
                Thread.sleep(forTimeInterval: 0.1)
            }
            DispatchQueue.main.async { [weak self] in
                self?.showLaunchFailure("The local agent bridge did not become ready. See ~/.agent-zen/native-bridge.log.")
            }
        }
    }

    private func launchBridge(upstreamPort: Int?, frontendBuildId: String) throws {
        let resources = Bundle.main.resourceURL!
        let bundle = resources.appendingPathComponent("agent-zen-bridge.js")
        let dist = resources.appendingPathComponent("dist")
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let inheritedPath = ProcessInfo.processInfo.environment["PATH"] ?? ""
        // The bridge is a JavaScript bundle run by the user's own Bun, not a compiled runtime.
        guard let bun = locateBun(home: home, inheritedPath: inheritedPath) else {
            throw BridgeLaunchError.bunMissing
        }

        let logDirectory = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".agent-zen")
        try FileManager.default.createDirectory(at: logDirectory, withIntermediateDirectories: true)
        let logURL = logDirectory.appendingPathComponent("native-bridge.log")
        if !FileManager.default.fileExists(atPath: logURL.path) {
            FileManager.default.createFile(atPath: logURL.path, contents: nil)
        }
        bridgeLog = try FileHandle(forWritingTo: logURL)
        try bridgeLog?.seekToEnd()

        let process = Process()
        process.executableURL = URL(fileURLWithPath: bun)
        process.arguments = ["--smol", bundle.path]
        let executablePaths = [
            "\(home)/.local/bin",
            "\(home)/.bun/bin",
            "\(home)/.cargo/bin",
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "/usr/bin",
            "/bin",
            "/usr/sbin",
            "/sbin",
        ]
        let searchPath = (executablePaths + inheritedPath.split(separator: ":").map(String.init))
            .reduce(into: [String]()) { paths, path in
                if !paths.contains(path) { paths.append(path) }
            }
        var environment = ProcessInfo.processInfo.environment.merging([
            "AGENT_ZEN_PORT": String(bundledBridgePort),
            "AGENT_ZEN_DIST_DIR": dist.path,
            "AGENT_ZEN_FRONTEND_BUILD_ID": frontendBuildId,
            "AGENT_ZEN_PARENT_PID": String(ProcessInfo.processInfo.processIdentifier),
            "PATH": searchPath.joined(separator: ":"),
        ]) { _, packaged in packaged }
        environment.removeValue(forKey: "AGENT_ZEN_UPSTREAM_BRIDGE_URL")
        if let upstreamPort {
            environment["AGENT_ZEN_UPSTREAM_BRIDGE_URL"] = "http://127.0.0.1:\(upstreamPort)"
        }
        if let codex = searchPath
            .map({ URL(fileURLWithPath: $0).appendingPathComponent("codex").path })
            .first(where: FileManager.default.isExecutableFile(atPath:)) {
            environment["AGENT_ZEN_CODEX_PATH"] = codex
        }
        process.environment = environment
        process.standardOutput = bridgeLog
        process.standardError = bridgeLog
        try process.run()
        bridgeProcess = process
    }

    private func bridgeIsHealthy(
        on port: Int,
        expectedFrontendBuildId: String? = nil,
        expectedFrontendApiPort: Int? = nil
    ) -> Bool {
        guard let url = URL(string: "http://127.0.0.1:\(port)/api/health") else { return false }
        var request = URLRequest(url: url)
        request.timeoutInterval = 0.35
        let result = LockedFlag()
        let finished = DispatchSemaphore(value: 0)
        URLSession.shared.dataTask(with: request) { data, response, _ in
            result.set(bridgeHealthIsCompatible(
                data: data,
                statusCode: (response as? HTTPURLResponse)?.statusCode,
                expectedProtocolVersion: agentZenBridgeProtocolVersion,
                expectedFrontendBuildId: expectedFrontendBuildId,
                expectedFrontendApiPort: expectedFrontendApiPort
            ))
            finished.signal()
        }.resume()
        _ = finished.wait(timeout: .now() + 0.5)
        return result.get()
    }

    private func loadApplication() {
        bridgeReady = true
        launchFailureMessage = nil
        statusSummaryItem.title = "Connected · Updating sessions…"
        if let windowSurface { loadWebApplication(surface: windowSurface) }
        refreshStatusSummary()
    }

    private func loadWebApplication(surface: WindowSurface) {
        let suffix = surface == .quickCapture ? "?surface=quick-capture" : ""
        guard let url = URL(string: "http://127.0.0.1:\(activePort)/\(suffix)") else { return }
        requestedWebSurface = surface
        loadedWebSurface = nil
        webView?.load(URLRequest(url: url))
    }

    private func refreshStatusSummary() {
        guard let url = URL(string: "http://127.0.0.1:\(activePort)/api/snapshot") else { return }
        guard bridgeReady, statusRefreshGate.begin() else { return }
        var request = URLRequest(url: url)
        request.timeoutInterval = 15
        URLSession.shared.dataTask(with: request) { [weak self] data, response, _ in
            let counts = (response as? HTTPURLResponse)?.statusCode == 200
                ? bridgeStageCounts(data: data)
                : nil
            DispatchQueue.main.async {
                guard let self else { return }
                self.statusRefreshGate.finish()
                if let counts {
                    self.statusSummaryItem.title = "\(counts.live) live session\(counts.live == 1 ? "" : "s")"
                    self.runningStatusItem.title = "Running  \(counts.running)"
                    self.reviewingStatusItem.title = "Reviewing  \(counts.reviewing)"
                    self.wrappingStatusItem.title = "Wrapping up  \(counts.wrapping)"
                    self.statusItem.button?.image = stageBarsImage(
                        running: counts.running,
                        reviewing: counts.reviewing,
                        wrapping: counts.wrapping
                    )
                    self.statusItem.button?.toolTip = "Agent Zen · \(counts.running) running · \(counts.reviewing) reviewing · \(counts.wrapping) wrapping up"
                } else if self.bridgeReady {
                    self.statusSummaryItem.title = "Connected · Session update delayed"
                }
                self.scheduleStatusRefresh()
            }
        }.resume()
    }

    private func scheduleStatusRefresh() {
        statusTimer?.invalidate()
        statusTimer = Timer.scheduledTimer(withTimeInterval: statusRefreshInterval, repeats: false) { [weak self] _ in
            self?.refreshStatusSummary()
        }
    }

    private func showBunMissingAlert() {
        let alert = NSAlert()
        alert.messageText = "Agent Zen needs Bun"
        alert.informativeText = "Install it with Homebrew, then open Agent Zen again:\n\nbrew install bun"
        alert.alertStyle = .warning
        alert.addButton(withTitle: "OK")
        NSApp.activate(ignoringOtherApps: true)
        alert.runModal()
    }

    private func showLaunchFailure(_ message: String) {
        launchFailureMessage = message
        statusSummaryItem.title = "Agent Zen bridge unavailable"
        guard webView != nil else { return }
        requestedWebSurface = nil
        loadedWebSurface = nil
        let escaped = message
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
        webView?.loadHTMLString("""
        <main style="font: 15px -apple-system; max-width: 36rem; margin: 12vh auto; line-height: 1.5">
          <h1 style="font-size: 22px">Agent Zen could not open</h1>
          <p>\(escaped)</p>
        </main>
        """, baseURL: nil)
    }

    @objc private func openNewIdea() {
        showQuickCapture()
    }

    @objc private func openSettings() {
        queueNativeEvent("agent-zen:settings", surface: .main)
    }

    @objc private func showWindow() {
        showMainWindow()
    }

    private func showMainWindow() {
        show(surface: .main)
    }

    private func showQuickCapture() {
        show(surface: .quickCapture)
    }

    private func show(surface: WindowSurface) {
        configureWindow()
        guard let window else { return }

        window.orderOut(nil)
        configureWindow(window, for: surface)
        if webView == nil { configureWebView(in: window) }
        windowSurface = surface
        switch windowContentAction(
            bridgeReady: bridgeReady,
            hasLaunchFailure: launchFailureMessage != nil,
            requestedSurface: requestedWebSurface,
            nextSurface: surface
        ) {
        case .showFailure:
            guard let launchFailureMessage else { return }
            showLaunchFailure(launchFailureMessage)
        case .loadApplication:
            loadWebApplication(surface: surface)
        case .showConnecting:
            webView?.loadHTMLString("""
            <main style="font: 14px -apple-system; display: grid; place-items: center; height: 100vh; color: #777">
              Connecting to Agent Zen…
            </main>
            """, baseURL: nil)
        case .keep:
            break
        }

        NSApp.setActivationPolicy(.regular)
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private func configureWindow(_ window: NSWindow, for surface: WindowSurface) {
        switch surface {
        case .main:
            window.styleMask = [.titled, .closable, .miniaturizable, .resizable]
            window.minSize = NSSize(width: 820, height: 620)
            if window.frame.width < 820 || window.frame.height < 620 {
                window.setContentSize(NSSize(width: 1240, height: 820))
                window.center()
            }
        case .quickCapture:
            window.styleMask = [.titled, .closable, .fullSizeContentView]
            window.minSize = NSSize(width: 600, height: 330)
            window.setContentSize(NSSize(width: 600, height: 330))
            window.center()
        }
    }

    @objc private func reload() {
        webView?.reload()
    }

    private func queueNativeEvent(_ name: String, surface: WindowSurface) {
        pendingNativeEvent = name
        show(surface: surface)
        if loadedWebSurface == surface && webView?.isLoading == false {
            dispatchPendingNativeEvent()
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard
            let surface = webApplicationSurface(url: webView.url, port: activePort),
            surface == requestedWebSurface
        else { return }
        loadedWebSurface = surface
        dispatchPendingNativeEvent()
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        if navigationAction.request.url?.scheme == "agent-zen" {
            decisionHandler(.cancel)
            hideWindowAndReleaseWebView()
            return
        }
        decisionHandler(.allow)
    }

    private func dispatchPendingNativeEvent() {
        guard let name = pendingNativeEvent else { return }
        pendingNativeEvent = nil
        webView?.evaluateJavaScript("window.dispatchEvent(new Event('\(name)'))")
    }

    private func configureGlobalShortcut() {
        let saved = UserDefaults.standard.string(forKey: shortcutDefaultsKey)
        let preset = saved.flatMap(QuickCaptureShortcutPreset.init(rawValue:)) ?? .optionSpace
        applyGlobalShortcut(preset, persist: false)
    }

    @objc private func selectQuickCaptureShortcut(_ sender: NSMenuItem) {
        guard
            let rawValue = sender.representedObject as? String,
            let preset = QuickCaptureShortcutPreset(rawValue: rawValue)
        else { return }
        applyGlobalShortcut(preset, persist: true)
    }

    private func applyGlobalShortcut(_ preset: QuickCaptureShortcutPreset, persist: Bool) {
        do {
            if let definition = preset.definition {
                try shortcutRegistry.register(definition)
            } else {
                shortcutRegistry.unregister()
            }
            if persist { UserDefaults.standard.set(preset.rawValue, forKey: shortcutDefaultsKey) }
            shortcutMenuItem.title = "Quick Capture Shortcut"
            shortcutMenuItem.toolTip = nil
            for (choice, item) in shortcutItems {
                item.state = choice == preset ? .on : .off
            }
        } catch {
            shortcutMenuItem.title = "Quick Capture Shortcut (Unavailable)"
            shortcutMenuItem.toolTip = error.localizedDescription
            if persist { NSSound.beep() }
        }
    }
}

private func stageBarsImage(running: Int, reviewing: Int, wrapping: Int) -> NSImage {
    let counts = [running, reviewing, wrapping]
    let image = NSImage(size: NSSize(width: 18, height: 16), flipped: false) { _ in
        NSColor.labelColor.setFill()
        for (index, count) in counts.enumerated() {
            let height = CGFloat(min(max(count, 0), 5)) * 2 + 2
            let rect = NSRect(x: CGFloat(index * 6 + 1), y: 2, width: 4, height: height)
            NSBezierPath(roundedRect: rect, xRadius: 1, yRadius: 1).fill()
        }
        return true
    }
    image.isTemplate = true
    image.accessibilityDescription = "Agent Zen session stages"
    return image
}

private enum BridgeLaunchError: Error {
    case bunMissing
}
