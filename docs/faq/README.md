# Agent Zen FAQ

Agent Zen is a local, Codex-first control plane: Codex owns session state; Agent Zen reads it, groups it, and adds a separate human Ideas and Logbook layer.

![Agent Zen stage contract](2026-08-07-agent-zen-stage-contract.png)

_Conceptual visual generated from the verified contracts below. The code and tests remain authoritative for exact predicates._

## How does Agent Zen connect to Codex?

**Short answer:** The local bridge combines supported Codex App Server control for sessions it launches with read-only process, SQLite, and rollout observation for sessions running elsewhere. ACP and hooks are not required.

On macOS, the observer asks `lsof` which rollout JSONL files are currently held open by live `codex` processes. Those thread ids define the active shelf. It then reads metadata from `~/.codex/state_5.sqlite` and lifecycle, message, plan, and completion records from the matching rollout files. It never writes to those stores. Agent Zen-owned launches use a bundled `codex app-server --stdio` child; externally launched sessions remain visible but read-only.

![Codex connection architecture](2026-08-06-agent-zen-codex-connection.png)

### Sources

- [ADR-0002](../adr/0002-native-codex-connection.md) — accepted integration boundary and rejected alternatives.
- [Codex observer](https://github.com/lucharo/agent-zen/blob/feat/codex-first-prototype/server/codex/stateObserver.ts) — SQLite and rollout observation.
- [Bridge service](https://github.com/lucharo/agent-zen/blob/feat/codex-first-prototype/server/bridgeService.ts) — observation and App Server control composition.

_Created: 2026-08-06 · Updated: 2026-08-06 · Verified: 2026-08-06 · Scope/version: Codex CLI 0.146-era local stores_

## What puts a session in each Sessions stage?

**Short answer:** Placement is derived, read-only, and evaluated in this precedence order: Wrapping up, Reviewing, Running, Planning. Ideas are human-authored records without a Codex thread.

| Stage | Exact qualifying condition |
| --- | --- |
| Ideas | A human-created Agent Zen idea; no Codex session exists yet. |
| Planning | A live Codex process owns the session and its latest turn has no native plan steps. The card can be actively planning or idle between turns. |
| Running | A live Codex process owns the session and its latest turn has one or more native plan steps. The card can be actively running or idle with its plan retained. |
| Reviewing | The latest turn begins a review action. This is either an explicit command line such as `$visual-review`, `/roborev-review`, or `$webapp-agent-demo`, or the agent actually loading a matching review skill. The marker remains while that Codex session stays open. |
| Wrapping up | The latest turn begins wrap-up. This is either an explicit `$wrapup` or `/wrapup` command line, or the agent actually loading the wrap-up skill. It overrides Reviewing and plan-derived placement. |
| Finished | The owning Codex process closes or unloads the rollout, or the thread is archived. The session then leaves the focus board. There is intentionally no Done column or approximate history counter. |

Mentioning a skill in prose does not move the card. For example, “I have not invoked `$wrapup`” remains plan-derived. A natural-language request such as “we are done, wrap up” moves only when the agent starts the wrap-up skill. Each new `task_started` record resets the turn-specific review/wrap-up hint and current plan.

### Sources

- [Stage derivation](https://github.com/lucharo/agent-zen/blob/feat/codex-first-prototype/src/domain/stage.ts) — precedence and plan predicates.
- [Rollout parser](https://github.com/lucharo/agent-zen/blob/feat/codex-first-prototype/server/codex/rollout.ts) — current-turn lifecycle, plan, review, and wrap-up extraction.
- [Stage tests](https://github.com/lucharo/agent-zen/blob/feat/codex-first-prototype/server/codex/rollout.test.ts) — marker persistence and precedence.

_Created: 2026-08-06 · Updated: 2026-08-07 · Verified: 2026-08-07_

## Which Codex sessions count as active, and why did idle ones disappear?

**Short answer:** A session is active while a live `codex` process holds its rollout file open. Completing a turn makes that session idle; it does not remove the card.

The earlier implementation treated the rollout's latest `task_complete` record as the end of the whole session. That collapsed two different lifecycles: a turn can finish while its terminal, Codex window, or cloud-worktree Codex process remains open for another turn. Agent Zen now inventories open rollout files from live Codex processes, then classifies the latest turn as `working` or `idle`.

This is why `data-pipeline-human-spec` remains visible after “HOLD ON FOR MORE!”: its latest turn completed, but its Codex process still owns the rollout. Child-agent rollouts are discovered by the same mechanism, but never become peer cards: Kanban nests them under their parent, Grid shows a compact subagent count, and the parent detail contains the full navigable list. Closing the owning process or archiving the thread removes it.

### Sources

- [Process inventory](https://github.com/lucharo/agent-zen/blob/feat/codex-first-prototype/server/codex/processInventory.ts) — open rollout discovery from live Codex processes.
- [Observer regression](https://github.com/lucharo/agent-zen/blob/feat/codex-first-prototype/server/codex/stateObserver.test.ts) — an idle process-owned session remains visible while stale unowned history does not.
- [Bridge regression](https://github.com/lucharo/agent-zen/blob/feat/codex-first-prototype/server/bridgeService.test.ts) — Agent Zen-owned turn completion becomes idle rather than disappearing.
- [Session grid](https://github.com/lucharo/agent-zen/blob/feat/codex-first-prototype/src/components/SessionGridView.tsx) — root-only peer projection.

_Created: 2026-08-07 · Updated: 2026-08-07 · Verified: 2026-08-07_

## Why did automated RoboRev sessions appear in Planning, and how are they hidden?

**Short answer:** They are ordinary live Codex execution threads with no plan, so the general classifier correctly called them Planning. Agent Zen now excludes the known generated RoboRev review-task title before classification.

The app-side exclusion is deliberately narrow: `source = exec` and a normalized title beginning `You are a code reviewer. Review the code changes shown below.` This avoids changing global RoboRev behaviour or hiding human review sessions. If RoboRev changes its generated title, the filter and fixture test must be updated.

### Sources

- [Observer query](https://github.com/lucharo/agent-zen/blob/feat/codex-first-prototype/server/codex/stateObserver.ts) — exact pre-classification exclusion.
- [Observer tests](https://github.com/lucharo/agent-zen/blob/feat/codex-first-prototype/server/codex/stateObserver.test.ts) — positive exclusion evidence.

_Created: 2026-08-06 · Updated: 2026-08-06 · Verified: 2026-08-06_

## How and how often does the board refresh?

**Short answer:** The UI requests a fresh snapshot every second. A separate 1-second UI clock updates elapsed-time labels.

Each snapshot first inventories rollout files held open by live Codex processes, then queries those exact thread ids from SQLite and examines their rollouts. Unchanged rollout files are reused by size and modification time. Changed files are tailed up to 1 MiB; for long active turns, the observer searches backwards for the latest lifecycle, plan, and stage-marker anchors so state does not disappear merely because it fell outside the tail window.

This is polling, not a hook. The maximum ordinary visible lag is therefore about one second plus local parsing time.

Snapshots also carry a protocol version. If the dashboard and bridge are from different builds, the UI stops and asks for a restart instead of mixing old data with new rendering rules.

### Sources

- [HTTP bridge client](https://github.com/lucharo/agent-zen/blob/feat/codex-first-prototype/src/bridge/httpBridge.ts) — 1-second polling and request timeout.
- [Codex observer](https://github.com/lucharo/agent-zen/blob/feat/codex-first-prototype/server/codex/stateObserver.ts) — cache, bounded tail, and anchor recovery.
- [App state provider](https://github.com/lucharo/agent-zen/blob/feat/codex-first-prototype/src/state/store.tsx) — 1-second display clock.

_Created: 2026-08-06 · Updated: 2026-08-07 · Verified: 2026-08-07_

## Are worktrees discovered and linked to their main project?

**Short answer:** Yes. The bridge discovers Git checkouts under configured roots. A session first matches the deepest project directory containing its cwd; an external worktree then falls back to the normalized GitHub remote.

Active session repositories register automatically, so the project filter and Settings registry describe the same live world. Observation and identity matching use all discovered candidates, and worktrees fall back to normalized remote identity, so every worktree does not become a separate project. Manual registration adds inactive repositories as launch targets. Both Sessions layouts can group cards by project; that changes presentation only.

### Sources

- [Project discovery](https://github.com/lucharo/agent-zen/blob/feat/codex-first-prototype/server/projects.ts) — Git checkout, branch, and remote discovery.
- [Observer project resolution](https://github.com/lucharo/agent-zen/blob/feat/codex-first-prototype/server/codex/stateObserver.ts) — cwd-first and repository fallback matching.
- [Kanban grouping](https://github.com/lucharo/agent-zen/blob/feat/codex-first-prototype/src/components/KanbanView.tsx) — project sections inside each stage.
- [Session grid](https://github.com/lucharo/agent-zen/blob/feat/codex-first-prototype/src/components/SessionGridView.tsx) — the same project grouping without stage columns.

_Created: 2026-08-06 · Updated: 2026-08-07 · Verified: 2026-08-07_

## Are the Sessions views editable?

**Short answer:** No. Session cards cannot be dragged between stages because that would create a second truth that can disagree with Codex.

Humans may capture ideas, register projects, add Logbook notes, choose filters and grouping, and control Agent Zen-owned sessions. Stage corrections belong in the observer or classifier rather than as per-card overrides.

### Sources

- [ADR-0005](../adr/0005-read-only-board-and-quiet-settings.md) — read-only board decision.
- [Kanban view](https://github.com/lucharo/agent-zen/blob/feat/codex-first-prototype/src/components/KanbanView.tsx) — stage presentation without mutation controls.
- [Session grid](https://github.com/lucharo/agent-zen/blob/feat/codex-first-prototype/src/components/SessionGridView.tsx) — root-only presentation without mutation controls.

_Created: 2026-08-06 · Updated: 2026-08-07 · Verified: 2026-08-07_

## Why can a session say “Outside a Git project”?

**Short answer:** Codex recorded a cwd that is not inside a discovered Git checkout, so Agent Zen has no safe project identity to attach.

Agent Zen never guesses a project from prompt text or a nearby directory. Sessions inside repositories and linked worktrees resolve by deepest checkout path, then by normalized Git remote. A session started from a parent directory containing several repositories remains explicitly outside a Git project.

### Sources

- [Observer project resolution](https://github.com/lucharo/agent-zen/blob/feat/codex-first-prototype/server/codex/stateObserver.ts) — cwd and remote matching.
- [Session cards](https://github.com/lucharo/agent-zen/blob/feat/codex-first-prototype/src/components/SessionCard.tsx) — honest fallback label.

_Created: 2026-08-07 · Updated: 2026-08-07 · Verified: 2026-08-07_

## What does the focus limit actually enforce?

**Short answer:** When enabled, it refuses only a new root-session launch after every slot is occupied. It never kills, pauses, or moves existing work.

Planning and Running root sessions consume slots while their Codex process remains open, including idle sessions between turns. Child agents share their parent's slot. Reviewing and Wrapping up release capacity. The limit defaults off, and concurrent launch requests are serialized so two requests cannot both claim the final slot.

### Sources

- [Focus policy](https://github.com/lucharo/agent-zen/blob/feat/codex-first-prototype/server/domain/focusPolicy.ts) — server-side launch decision.
- [Stage domain](https://github.com/lucharo/agent-zen/blob/feat/codex-first-prototype/src/domain/stage.ts) — active-slot counting rules.
- [Bridge service](https://github.com/lucharo/agent-zen/blob/feat/codex-first-prototype/server/bridgeService.ts) — serialized enforcement before launch.

_Created: 2026-08-06 · Updated: 2026-08-06 · Verified: 2026-08-06_

## Where do Ideas and Logbook notes live, and why were mock ideas visible?

**Short answer:** They live only in browser localStorage under `agent-zen.state.v1`. The visible mock ideas were mistakenly shipped as production defaults; production now starts empty and migrates known prototype records away.

The current persisted schema is version 2 even though the storage key retains its old name so existing data can be migrated. Migration removes only the exact prototype IDs; user-created ideas and notes are preserved. Registered projects, focus settings, and Agent Zen-owned thread identity instead live in `~/.agent-zen/settings.json`.

Clearing site data deletes local Ideas and Logbook notes. Cross-browser or cross-machine sync is not implemented.

### Sources

- [Local persistence](https://github.com/lucharo/agent-zen/blob/feat/codex-first-prototype/src/state/persistence.ts) — empty defaults, schema migration, and exact prototype IDs.
- [Persistence tests](https://github.com/lucharo/agent-zen/blob/feat/codex-first-prototype/src/domain/derivation.test.ts) — prototype removal and user-data preservation.
- [Settings store](https://github.com/lucharo/agent-zen/blob/feat/codex-first-prototype/server/settings.ts) — bridge-owned durable settings.

_Created: 2026-08-06 · Updated: 2026-08-06 · Verified: 2026-08-06 · Scope/version: local schema v2_

## Where did “113 finished sessions in history” come from?

**Short answer:** It was not a trustworthy history total. The observer loaded a bounded window of 120 recent threads; at that moment seven were live, so the UI displayed the remaining 113 as “history”.

That counter has been removed. The bridge now sends sessions owned by live Codex processes to the focus board and does not imply that the unarchived thread catalog is active work or complete history. A real history view would need explicit pagination and a clear retention contract.

### Sources

- [Bridge service](https://github.com/lucharo/agent-zen/blob/feat/codex-first-prototype/server/bridgeService.ts) — active-session projection.
- [App tests](https://github.com/lucharo/agent-zen/blob/feat/codex-first-prototype/src/app.test.tsx) — no synthetic history count.
- [Codex observer](https://github.com/lucharo/agent-zen/blob/feat/codex-first-prototype/server/codex/stateObserver.ts) — exact process-active query with a bounded live-turn fallback when process discovery is unavailable.

_Created: 2026-08-06 · Updated: 2026-08-06 · Verified: 2026-08-06_

## How do Sessions layouts, dense columns, and card detail work?

**Short answer:** Sessions switches between Kanban and Grid. Every Kanban stage header shows its visible count; columns scroll independently and show a bottom “Scroll for more” affordance. Grid gives every session its own equal-size, stage-labelled card. Both layouts can display full details or titles only.

Horizontal trackpad gestures over a Kanban column bubble to the board, while vertical gestures remain with that column. The page itself never becomes a second horizontal scroll owner. Grid title cards are `260 × 152px`; detail cards are `260 × 252px`, top-aligned without stretching to fill sparse rows. Cards reveal repository, branch, worktree, model, effort, Codex version, and IDs after a 1.2-second hover delay. Keyboard focus reveals the same information immediately. Group by Project works in both layouts without duplicating the project label on each card.

### Sources

- [Kanban view](https://github.com/lucharo/agent-zen/blob/feat/codex-first-prototype/src/components/KanbanView.tsx) — counts, overflow detection, grouping, and detail mode.
- [Kanban styles](https://github.com/lucharo/agent-zen/blob/feat/codex-first-prototype/src/components/KanbanView.module.css) — fixed headers and scroll affordance.
- [Session grid](https://github.com/lucharo/agent-zen/blob/feat/codex-first-prototype/src/components/SessionGridView.tsx) — stage-labelled root-session projection.
- [Scroll regression](https://github.com/lucharo/agent-zen/blob/feat/codex-first-prototype/qa/e2e/session-scroll.spec.ts) — one horizontal owner and two-axis wheel routing.
- [Session card styles](https://github.com/lucharo/agent-zen/blob/feat/codex-first-prototype/src/components/SessionCard.module.css) — delayed hover and immediate focus disclosure.

_Created: 2026-08-06 · Updated: 2026-08-07 · Verified: 2026-08-07_

## What does Quick Capture create?

**Short answer:** One local Idea. It does not launch a session or create a GitHub issue.

The centred capture dialog contains title, notes, and one optional project field. Selecting a project also records its linked repository, so a separate repository field would be duplicate noise. `C` opens capture in the browser, `Command-N` does so in the native shell, `Command-M` jumps to Project, and `Command-Return` saves. Capture keeps these field hints visible as part of its keyboard-first form; toolbar button hints appear only while Command is held. Focus stays in the field the human selected while shortcut hints or live session data update behind the dialog.

![Agent Zen centred Quick Capture](2026-08-07-agent-zen-quick-capture.png)

### Sources

- [Quick Capture](https://github.com/lucharo/agent-zen/blob/feat/codex-first-prototype/src/components/CaptureSheet.tsx) — Ideas-only capture contract.
- [Overlay primitive](https://github.com/lucharo/agent-zen/blob/feat/codex-first-prototype/src/components/primitives.tsx) — stable focus and modal keyboard handling.
- [Capture regression](https://github.com/lucharo/agent-zen/blob/feat/codex-first-prototype/src/app.test.tsx) — field focus survives surrounding rerenders.

_Created: 2026-08-07 · Updated: 2026-08-07 · Verified: 2026-08-07_

## Why does Command-N open a browser window, and what does the native app change?

**Short answer:** Browsers reserve Command-N before page JavaScript can reliably handle it, so the web app truthfully uses `C`. The native WKWebView shell owns real macOS menu commands for Command-N New Idea and Command-, Settings.

The shell also adds a menu-bar companion showing active and visible session counts, with Open Agent Zen, New Idea, Settings, and Quit actions. Its embedded bridge is served on its own loopback origin, and the UI automatically connects back to that origin. The shell explicitly locates user-local `codex` installs because Finder-launched apps do not inherit the login-shell PATH.

This is an environment/distribution blocker, not a JavaScript shortcut bug.

### Sources

- [Native shell](https://github.com/lucharo/agent-zen/blob/feat/codex-first-prototype/native/AgentZenApp.swift) — menus, WKWebView, bridge ownership, and menu-bar status.
- [macOS build](https://github.com/lucharo/agent-zen/blob/feat/codex-first-prototype/scripts/build-macos-app.sh) — app bundling and automatic Apple-identity selection.
- [Bridge URL tests](https://github.com/lucharo/agent-zen/blob/feat/codex-first-prototype/src/bridge/httpBridge.test.ts) — browser-development and packaged-origin routing.
- [ADR-0006](../adr/0006-browser-keyboard-and-accessibility.md) — keyboard and accessibility contract.



## How should the native app be distributed?

**Short answer:** First test an Apple-signed native build on the personal Mac, then ship a hardened and notarised Developer ID build. Treat the Mac App Store as a later distribution target.

`bun run build:macos` automatically prefers `Developer ID Application`, then `Apple Development`, and otherwise emits an explicitly warned ad-hoc build. It signs the compiled Bun bridge with the required JavaScriptCore JIT entitlements before signing and verifying the outer app. An Apple Developer account helps, but Xcode or the developer portal must create and install the certificate and private key on the build Mac.

The Mac App Store requires sandboxing. Agent Zen needs deliberate entitlements and user-granted access for local Codex stores, repositories, Git, and subprocess control, so that work should be designed and tested rather than added as a packaging afterthought.

### Sources

- [Native distribution ADR](../adr/0007-native-shell-and-distribution.md) — accepted distribution ladder and current blocker.
- [Apple certificates overview](https://developer.apple.com/help/account/certificates/certificates-overview/) — certificate types and management.
- [Apple notarisation guidance](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution) — Developer ID notarisation requirement.

_Created: 2026-08-06 · Updated: 2026-08-06 · Verified: 2026-08-06_

## What does project onboarding do?

**Short answer:** Active Git repositories register themselves. The onboarding dialog adds inactive checkouts the user wants available as launch targets.

Discovery shows repository identity, path, branch, and registration state. Launching still requires a registered project so the local bridge never accepts an arbitrary cwd from the browser; automatic registration is limited to repositories already evidenced by a visible active Codex session.

### Sources

- [Project onboarding UI](https://github.com/lucharo/agent-zen/blob/feat/codex-first-prototype/src/components/ProjectOnboardingDialog.tsx) — selection flow.
- [Project discovery](https://github.com/lucharo/agent-zen/blob/feat/codex-first-prototype/server/projects.ts) — local Git metadata.
- [Security tests](https://github.com/lucharo/agent-zen/blob/feat/codex-first-prototype/server/security.test.ts) — loopback and launch-boundary checks.

_Created: 2026-08-06 · Updated: 2026-08-07 · Verified: 2026-08-07_

## Which earlier visuals are retained?

**Short answer:** The connection diagram, live-demo poster, current stage contract, and Quick Capture screenshot are stored beside this FAQ so they remain discoverable after the session dashboard disappears.

- [Codex connection architecture](2026-08-06-agent-zen-codex-connection.png)
- [Live Codex demo poster](2026-08-06-agent-zen-live-demo-poster.png)
- [Current stage contract](2026-08-07-agent-zen-stage-contract.png)
- [Centred Quick Capture](2026-08-07-agent-zen-quick-capture.png)
- [Superseded 2-second stage/refresh visual](2026-08-06-agent-zen-stage-refresh.png)
- Browser QA evidence is retained in the repository's `qa/` directory.

![Agent Zen live Codex demo poster](2026-08-06-agent-zen-live-demo-poster.png)

The poster records the first live bridge demonstration; it is historical evidence, not the current UI specification.

### Sources

- Repository `qa/README.md` — retained screenshots, video, and validation context.
- Repository `explorations/2026-08-05-codex-zen-directions/README.md` — selected visual direction.

_Created: 2026-08-06 · Updated: 2026-08-07 · Verified: 2026-08-07_
