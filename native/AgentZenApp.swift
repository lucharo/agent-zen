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
final class AgentZenApp: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    private let port = 5275
    private var window: NSWindow!
    private var webView: WKWebView!
    private var statusItem: NSStatusItem!
    private var statusSummaryItem: NSMenuItem!
    private var statusTimer: Timer?
    private var bridgeProcess: Process?
    private var bridgeLog: FileHandle?

    func applicationDidFinishLaunching(_ notification: Notification) {
        configureMenus()
        configureStatusItem()
        configureWindow()
        startBridgeAndLoad()
    }

    func applicationWillTerminate(_ notification: Notification) {
        if let process = bridgeProcess, process.isRunning {
            process.terminate()
        }
        try? bridgeLog?.close()
        statusTimer?.invalidate()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showWindow()
        return true
    }

    private func configureWindow() {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()

        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.customUserAgent = "AgentZenNative/1.0"
        webView.navigationDelegate = self

        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1240, height: 820),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.title = "Agent Zen"
        window.minSize = NSSize(width: 820, height: 620)
        window.titlebarAppearsTransparent = true
        window.contentView = webView
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private func configureStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        if let button = statusItem.button {
            button.image = NSImage(
                systemSymbolName: "rectangle.3.group.bubble.left.fill",
                accessibilityDescription: "Agent Zen"
            )
            button.toolTip = "Agent Zen"
        }

        let menu = NSMenu(title: "Agent Zen")
        statusSummaryItem = menu.addItem(withTitle: "Connecting to Codex…", action: nil, keyEquivalent: "")
        statusSummaryItem.isEnabled = false
        menu.addItem(.separator())
        let openItem = menu.addItem(withTitle: "Open Agent Zen", action: #selector(showWindow), keyEquivalent: "")
        openItem.target = self
        let newIdeaItem = menu.addItem(withTitle: "New Idea", action: #selector(openNewIdea), keyEquivalent: "n")
        newIdeaItem.target = self
        let settingsItem = menu.addItem(withTitle: "Settings…", action: #selector(openSettings), keyEquivalent: ",")
        settingsItem.target = self
        menu.addItem(.separator())
        menu.addItem(withTitle: "Quit Agent Zen", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        statusItem.menu = menu
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
        if bridgeIsHealthy() {
            loadApplication()
            return
        }

        do {
            try launchBridge()
        } catch {
            showLaunchFailure("Could not start the local Codex bridge: \(error.localizedDescription)")
            return
        }

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }
            for _ in 0..<80 {
                if self.bridgeIsHealthy() {
                    DispatchQueue.main.async { [weak self] in self?.loadApplication() }
                    return
                }
                Thread.sleep(forTimeInterval: 0.1)
            }
            DispatchQueue.main.async { [weak self] in
                self?.showLaunchFailure("The local Codex bridge did not become ready. See ~/.agent-zen/native-bridge.log.")
            }
        }
    }

    private func launchBridge() throws {
        let resources = Bundle.main.resourceURL!
        let executable = resources.appendingPathComponent("agent-zen-bridge")
        let dist = resources.appendingPathComponent("dist")

        let logDirectory = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".agent-zen")
        try FileManager.default.createDirectory(at: logDirectory, withIntermediateDirectories: true)
        let logURL = logDirectory.appendingPathComponent("native-bridge.log")
        if !FileManager.default.fileExists(atPath: logURL.path) {
            FileManager.default.createFile(atPath: logURL.path, contents: nil)
        }
        bridgeLog = try FileHandle(forWritingTo: logURL)
        try bridgeLog?.seekToEnd()

        let process = Process()
        process.executableURL = executable
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let inheritedPath = ProcessInfo.processInfo.environment["PATH"] ?? ""
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
            "AGENT_ZEN_PORT": String(port),
            "AGENT_ZEN_DIST_DIR": dist.path,
            "PATH": searchPath.joined(separator: ":"),
        ]) { _, packaged in packaged }
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

    private func bridgeIsHealthy() -> Bool {
        guard let url = URL(string: "http://127.0.0.1:\(port)/api/health") else { return false }
        var request = URLRequest(url: url)
        request.timeoutInterval = 0.35
        let result = LockedFlag()
        let finished = DispatchSemaphore(value: 0)
        URLSession.shared.dataTask(with: request) { _, response, _ in
            result.set((response as? HTTPURLResponse)?.statusCode == 200)
            finished.signal()
        }.resume()
        _ = finished.wait(timeout: .now() + 0.5)
        return result.get()
    }

    private func loadApplication() {
        guard let url = URL(string: "http://127.0.0.1:\(port)/") else { return }
        webView.load(URLRequest(url: url))
        refreshStatusSummary()
        statusTimer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
            self?.refreshStatusSummary()
        }
    }

    private func refreshStatusSummary() {
        guard let url = URL(string: "http://127.0.0.1:\(port)/api/snapshot") else { return }
        URLSession.shared.dataTask(with: url) { [weak self] data, response, _ in
            guard
                let data,
                (response as? HTTPURLResponse)?.statusCode == 200,
                let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                let sessions = object["sessions"] as? [[String: Any]],
                let focus = object["focus"] as? [String: Any],
                let active = focus["activeCount"] as? Int
            else { return }
            DispatchQueue.main.async {
                self?.statusSummaryItem.title = "\(active) active · \(sessions.count) visible"
            }
        }.resume()
    }

    private func showLaunchFailure(_ message: String) {
        let escaped = message
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
        webView.loadHTMLString("""
        <main style="font: 15px -apple-system; max-width: 36rem; margin: 12vh auto; line-height: 1.5">
          <h1 style="font-size: 22px">Agent Zen could not open</h1>
          <p>\(escaped)</p>
        </main>
        """, baseURL: nil)
    }

    @objc private func openNewIdea() {
        showWindow()
        webView.evaluateJavaScript("window.dispatchEvent(new Event('agent-zen:new-idea'))")
    }

    @objc private func openSettings() {
        showWindow()
        webView.evaluateJavaScript("window.dispatchEvent(new Event('agent-zen:settings'))")
    }

    @objc private func showWindow() {
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    @objc private func reload() {
        webView.reload()
    }
}
