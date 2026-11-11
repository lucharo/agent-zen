# Homebrew cask for the notarised Agent Zen app.
#   brew tap lucharo/agent-zen https://github.com/lucharo/agent-zen.git
#   brew trust --tap lucharo/agent-zen
#   brew install --cask agent-zen
# `scripts/release-macos.sh --publish` rewrites version and sha256 on every release.
cask "agent-zen" do
  version "0.1.3"
  sha256 "e172956a07bb028f6de46341aada9e8b766e8445d774f7b0e58e0dad3e1ff0fc"

  url "https://github.com/lucharo/agent-zen/releases/download/v#{version}/AgentZen-#{version}.dmg"
  name "Agent Zen"
  desc "Calm local view of running Codex and Claude Code sessions"
  homepage "https://github.com/lucharo/agent-zen"

  depends_on macos: :sonoma
  depends_on formula: "bun"

  app "Agent Zen.app"
end
