# Homebrew cask for the notarised Agent Zen app.
#   brew tap lucharo/agent-zen https://github.com/lucharo/agent-zen.git
#   brew trust --tap lucharo/agent-zen
#   brew install --cask agent-zen
# `scripts/release-macos.sh --publish` rewrites version and sha256 on every release.
cask "agent-zen" do
  version "0.1.2"
  sha256 "3092e0a67bb75eff999f46e2a08877e24fc66a3d8e95ac1bccafe399a59cea7e"

  url "https://github.com/lucharo/agent-zen/releases/download/v#{version}/AgentZen-#{version}.dmg"
  name "Agent Zen"
  desc "Calm local view of running Codex and Claude Code sessions"
  homepage "https://github.com/lucharo/agent-zen"

  depends_on macos: :sonoma

  app "Agent Zen.app"
end
