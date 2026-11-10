# Homebrew cask for the notarised Agent Zen app.
#   brew tap lucharo/agent-zen https://github.com/lucharo/agent-zen.git
#   brew trust --tap lucharo/agent-zen
#   brew install --cask agent-zen
# `scripts/release-macos.sh --publish` rewrites version and sha256 on every release.
cask "agent-zen" do
  version "0.1.1"
  sha256 "89bfd27825a11fb07757e4876225770881615c4e13810779a48762285fd78d9c"

  url "https://github.com/lucharo/agent-zen/releases/download/v#{version}/AgentZen-#{version}.dmg"
  name "Agent Zen"
  desc "Calm local view of running Codex and Claude Code sessions"
  homepage "https://github.com/lucharo/agent-zen"

  depends_on macos: :sonoma

  app "Agent Zen.app"
end
