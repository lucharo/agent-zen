import Foundation

@main
enum BridgeProtocolTests {
    static func main() {
        let current = Data(#"{"protocolVersion":7}"#.utf8)
        let stale = Data(#"{"protocolVersion":6}"#.utf8)
        let unrelated = Data(#"{"status":"ok"}"#.utf8)

        precondition(bridgeHealthIsCompatible(
            data: current,
            statusCode: 200,
            expectedProtocolVersion: 7
        ))
        precondition(!bridgeHealthIsCompatible(
            data: stale,
            statusCode: 200,
            expectedProtocolVersion: 7
        ))
        precondition(!bridgeHealthIsCompatible(
            data: unrelated,
            statusCode: 200,
            expectedProtocolVersion: 7
        ))
        precondition(!bridgeHealthIsCompatible(
            data: current,
            statusCode: 500,
            expectedProtocolVersion: 7
        ))
        let currentFrontend = Data(#"{"protocolVersion":7,"frontendBuildId":"current","frontendApiPort":5274}"#.utf8)
        precondition(bridgeHealthIsCompatible(
            data: currentFrontend,
            statusCode: 200,
            expectedProtocolVersion: 7,
            expectedFrontendBuildId: "current",
            expectedFrontendApiPort: 5274
        ))
        precondition(!bridgeHealthIsCompatible(
            data: currentFrontend,
            statusCode: 200,
            expectedProtocolVersion: 7,
            expectedFrontendBuildId: "stale",
            expectedFrontendApiPort: 5274
        ))

        let snapshot = Data(#"""
        {
          "sessions": [
            {"parentSessionId": null, "classification": {"stage": "running"}},
            {"parentSessionId": null, "classification": {"stage": "reviewing"}},
            {"parentSessionId": null, "classification": {"stage": "wrapping-up"}},
            {"parentSessionId": null, "classification": {"stage": "planning"}},
            {"parentSessionId": "parent", "classification": {"stage": "running"}}
          ]
        }
        """#.utf8)
        precondition(bridgeStageCounts(data: snapshot) == BridgeStageCounts(
            visible: 5,
            running: 1,
            reviewing: 1,
            wrapping: 1
        ))
        precondition(bridgeStageCounts(data: Data(#"{}"#.utf8)) == nil)

        let refreshGate = SingleFlightGate()
        precondition(refreshGate.begin())
        precondition(!refreshGate.begin())
        refreshGate.finish()
        precondition(refreshGate.begin())

        precondition(windowContentAction(
            bridgeReady: true,
            hasLaunchFailure: false,
            requestedSurface: nil,
            nextSurface: .quickCapture
        ) == .loadApplication)
        precondition(windowContentAction(
            bridgeReady: true,
            hasLaunchFailure: false,
            requestedSurface: .quickCapture,
            nextSurface: .quickCapture
        ) == .keep)
        precondition(windowContentAction(
            bridgeReady: true,
            hasLaunchFailure: false,
            requestedSurface: .quickCapture,
            nextSurface: .main
        ) == .loadApplication)
        precondition(windowContentAction(
            bridgeReady: false,
            hasLaunchFailure: false,
            requestedSurface: nil,
            nextSurface: .main
        ) == .showConnecting)
        precondition(webApplicationSurface(
            url: URL(string: "http://127.0.0.1:5274/?surface=quick-capture"),
            port: 5274
        ) == .quickCapture)
        precondition(webApplicationSurface(
            url: URL(string: "http://127.0.0.1:5274/"),
            port: 5274
        ) == .main)
        precondition(webApplicationSurface(url: nil, port: 5274) == nil)
        precondition(webApplicationSurface(
            url: URL(string: "http://127.0.0.1:5275/"),
            port: 5274
        ) == nil)

        precondition(QuickCaptureShortcutPreset.optionSpace.definition?.label == "⌥ Space")
        precondition(QuickCaptureShortcutPreset.controlSpace.definition?.label == "⌃ Space")
        precondition(QuickCaptureShortcutPreset.disabled.definition == nil)

        print("Native bridge and shortcut contract tests passed")
    }
}
