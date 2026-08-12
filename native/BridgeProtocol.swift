import Foundation

enum WindowSurface: Equatable {
    case main
    case quickCapture
}

enum WindowContentAction: Equatable {
    case keep
    case loadApplication
    case showConnecting
    case showFailure
}

func windowContentAction(
    bridgeReady: Bool,
    hasLaunchFailure: Bool,
    requestedSurface: WindowSurface?,
    nextSurface: WindowSurface
) -> WindowContentAction {
    if hasLaunchFailure { return .showFailure }
    if !bridgeReady { return .showConnecting }
    return requestedSurface == nextSurface ? .keep : .loadApplication
}

func webApplicationSurface(url: URL?, port: Int) -> WindowSurface? {
    guard
        let url,
        url.scheme == "http",
        url.host == "127.0.0.1",
        url.port == port,
        url.path == "/"
    else { return nil }

    let surface = URLComponents(url: url, resolvingAgainstBaseURL: false)?
        .queryItems?
        .first(where: { $0.name == "surface" })?
        .value
    return surface == "quick-capture" ? .quickCapture : .main
}

final class SingleFlightGate {
    private let lock = NSLock()
    private var active = false

    func begin() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard !active else { return false }
        active = true
        return true
    }

    func finish() {
        lock.lock()
        active = false
        lock.unlock()
    }
}

private struct BridgeHealthResponse: Decodable {
    let protocolVersion: Int
    let frontendBuildId: String?
    let frontendApiPort: Int?
}

private struct BridgeSnapshotSummary: Decodable {
    struct Session: Decodable {
        struct Classification: Decodable {
            let stage: String
        }

        let parentSessionId: String?
        let classification: Classification?
    }

    let sessions: [Session]
}

struct BridgeStageCounts: Equatable {
    let visible: Int
    let running: Int
    let reviewing: Int
    let wrapping: Int
}

func bridgeHealthIsCompatible(
    data: Data?,
    statusCode: Int?,
    expectedProtocolVersion: Int,
    expectedFrontendBuildId: String? = nil,
    expectedFrontendApiPort: Int? = nil
) -> Bool {
    guard
        statusCode == 200,
        let data,
        let health = try? JSONDecoder().decode(BridgeHealthResponse.self, from: data)
    else { return false }
    guard health.protocolVersion == expectedProtocolVersion else { return false }
    if let expectedFrontendBuildId, health.frontendBuildId != expectedFrontendBuildId {
        return false
    }
    if let expectedFrontendApiPort, health.frontendApiPort != expectedFrontendApiPort {
        return false
    }
    return true
}

func bridgeStageCounts(data: Data?) -> BridgeStageCounts? {
    guard
        let data,
        let snapshot = try? JSONDecoder().decode(BridgeSnapshotSummary.self, from: data)
    else { return nil }

    var running = 0
    var reviewing = 0
    var wrapping = 0
    for session in snapshot.sessions where session.parentSessionId == nil {
        switch session.classification?.stage {
        case "running": running += 1
        case "reviewing": reviewing += 1
        case "wrapping-up": wrapping += 1
        default: break
        }
    }
    return BridgeStageCounts(
        visible: snapshot.sessions.count,
        running: running,
        reviewing: reviewing,
        wrapping: wrapping
    )
}
