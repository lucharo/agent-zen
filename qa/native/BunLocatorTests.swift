import Foundation

@main
enum BunLocatorTests {
    static func main() {
        let home = "/Users/tester"
        let path = "/opt/homebrew/bin:/custom/bin:/usr/bin"

        precondition(bunCandidates(home: home, inheritedPath: path) == [
            "/opt/homebrew/bin/bun",
            "/usr/local/bin/bun",
            "/Users/tester/.bun/bin/bun",
            "/custom/bin/bun",
            "/usr/bin/bun",
        ])

        // Homebrew wins over a ~/.bun install, which wins over PATH.
        precondition(locateBun(home: home, inheritedPath: path, isExecutable: { _ in true }) == "/opt/homebrew/bin/bun")
        precondition(locateBun(home: home, inheritedPath: path, isExecutable: {
            $0 == "/Users/tester/.bun/bin/bun" || $0 == "/custom/bin/bun"
        }) == "/Users/tester/.bun/bin/bun")
        precondition(locateBun(home: home, inheritedPath: path, isExecutable: { $0 == "/custom/bin/bun" }) == "/custom/bin/bun")

        // No Bun anywhere: the app shows the install message instead of failing silently.
        precondition(locateBun(home: home, inheritedPath: path, isExecutable: { _ in false }) == nil)
        precondition(bunMissingMessage == "Agent Zen needs Bun: brew install bun")

        print("BunLocatorTests passed")
    }
}
