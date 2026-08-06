# ADR-0006: Browser keyboard and accessibility contract

- Status: Accepted
- Date: 2026-08-06

## Outcome

Agent Zen keeps keyboard capture fast without pretending the browser can override operating-system window commands. Its small component set follows a WCAG 2.2 AA contract and is checked with axe in a real browser.

## Answered grill

- **Why does `⌘N` open a browser window?** The browser owns that shortcut before page JavaScript can reliably use it.
- **What opens capture on the web?** Plain `C` when focus is not in an editable control. The command palette and the visible add control both disclose it.
- **How are other shortcuts discovered?** `⌘K` opens the command palette, which lists command shortcuts. Holding Command reveals contextual hints on toolbar controls.
- **Why not import a full component system?** Agent Zen currently needs a small set of native controls, overlays, and cards. A large dependency would add surface area without improving the present interaction contract.
- **What is the accessibility bar?** WCAG 2.2 AA semantics, contrast, keyboard order, visible focus, focus trapping and return, reduced motion, and native control behaviour.

## Decision

- Use native `button`, `select`, `input`, `textarea`, and dialog semantics wherever possible.
- Centralise modal focus trapping, Escape dismissal, focus return, and body scroll locking in one overlay primitive.
- Keep quick capture, Settings, project onboarding, and session detail centred over blurred context.
- Preserve a visible two-pixel focus outline in addition to the soft product focus ring.
- Use complete light and dark token sets, avoid low-contrast metadata colours, and respect `prefers-reduced-motion`.
- Run Playwright plus axe against Kanban, quick capture, Ideas, and Settings as a release check.

## Consequences

- The browser shortcut is truthful rather than imitating a native command it cannot own.
- The native macOS shell maps the same capture command to `⌘N` and Settings to `⌘,` without changing the product command model.
- New primitives or visual tokens must pass the same keyboard and automated accessibility checks before use.

See [ADR-0007](0007-native-shell-and-distribution.md).

## Rejected alternatives

- **Keep advertising `⌘N` in the web app:** misleading because it opens a new window in real browsers.
- **Rely on colour and hover alone:** inaccessible to keyboard, low-vision, and touch users.
- **Adopt Astryx immediately:** it is a credible accessible component source, but the current app does not need enough primitives to justify importing a second design language.
