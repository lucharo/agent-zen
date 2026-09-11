# Homebrew cask for the notarised Agent Zen app. The repository is private, so
# the DMG is fetched through the GitHub API with the caller's token:
#   gh auth setup-git   # once; the private tap is cloned over HTTPS with gh's token
#   export HOMEBREW_GITHUB_API_TOKEN="$(gh auth token)"
#   brew trust --tap lucharo/agent-zen && brew trust --cask lucharo/agent-zen/agent-zen
#   brew tap lucharo/agent-zen https://github.com/lucharo/agent-zen.git
#   brew install --cask agent-zen
# `scripts/release-macos.sh --publish` rewrites version, sha256 and the asset
# id on every release. Values below are placeholders until the first publish.
cask "agent-zen" do
  version "0.1.0"
  sha256 "252856923b2455efa5ee97cafe0fb480e65627000aa4d4c9a373ec25d57ef840"

  url "https://api.github.com/repos/lucharo/agent-zen/releases/assets/557684803",
      header: [
        "Accept: application/octet-stream",
        "Authorization: Bearer #{ENV.fetch("HOMEBREW_GITHUB_API_TOKEN", "")}",
      ]
  name "Agent Zen"
  desc "Quiet local control plane for ideas, focus and Claude/Codex sessions"
  homepage "https://github.com/lucharo/agent-zen"

  depends_on macos: :sonoma

  app "Agent Zen.app"
end
