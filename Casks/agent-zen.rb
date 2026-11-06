# Homebrew cask for the notarised Agent Zen app.
#   brew tap lucharo/agent-zen https://github.com/lucharo/agent-zen.git
#   brew trust --tap lucharo/agent-zen
#   brew install --cask agent-zen
# `scripts/release-macos.sh --publish` rewrites version and sha256 on every release.
cask "agent-zen" do
  version "0.1.0"
  sha256 "252856923b2455efa5ee97cafe0fb480e65627000aa4d4c9a373ec25d57ef840"

  url "https://github.com/lucharo/agent-zen/releases/download/v#{version}/AgentZen-#{version}.dmg"
  name "Agent Zen"
  desc "Quiet local control plane for ideas, focus and Claude/Codex sessions"
  homepage "https://github.com/lucharo/agent-zen"

  depends_on macos: :sonoma

  app "Agent Zen.app"
end
