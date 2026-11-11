import Foundation

/// The message shown when no Bun is installed; the cask depends on the `bun` formula.
let bunMissingMessage = "Agent Zen needs Bun: brew install bun"

/// Where the bundled bridge's runtime is looked for, in order. A Finder-launched app does not
/// inherit the login shell's PATH, so the usual install locations come first and the inherited
/// PATH last.
func bunCandidates(home: String, inheritedPath: String) -> [String] {
    let fixed = [
        "/opt/homebrew/bin/bun",
        "/usr/local/bin/bun",
        "\(home)/.bun/bin/bun",
    ]
    let fromPath = inheritedPath
        .split(separator: ":")
        .filter { !$0.isEmpty }
        .map { URL(fileURLWithPath: String($0)).appendingPathComponent("bun").path }
    return (fixed + fromPath).reduce(into: [String]()) { paths, path in
        if !paths.contains(path) { paths.append(path) }
    }
}

/// The first candidate that is an executable file, or nil when Bun is not installed.
func locateBun(
    home: String,
    inheritedPath: String,
    isExecutable: (String) -> Bool = FileManager.default.isExecutableFile(atPath:)
) -> String? {
    bunCandidates(home: home, inheritedPath: inheritedPath).first(where: isExecutable)
}
