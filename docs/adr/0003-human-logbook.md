# ADR-0003: Human Logbook separate from agent state

- Status: Accepted
- Date: 2026-08-06
- Updated: 2026-08-11

## Outcome

Every idea or session may have a local, human-only Logbook: an append-only place for notes to self, context, and decisions. It is visibly separate from the agent-authored session plan and event stream.

## Answered grill

- **Why is this not another agent chat?** The purpose is to retain the human's thinking without asking an agent to interpret, answer, or act on every note.
- **Who may author it?** The human only. Agents can neither add, rewrite, nor silently summarise Logbook entries.
- **What can an entry attach to?** An idea, session, or registered project.
- **Where does it live?** In Agent Zen's local store, independently of Codex rollouts and GitHub issues.
- **Is it a task ledger?** No. It carries narrative context, not agent plan status or required session ceremony.

## Decision

- Store immutable entry text, author timestamp, and attachment identity locally.
- Permit correction by adding a new entry or explicit human edit history; never let session refresh overwrite notes.
- Keep Logbook authorship visually distinct from read-only native agent state. The detail view keeps the full Logbook separate; an explicit card preference may show labelled excerpts.
- Keep capture friction low enough for “note to self” use while avoiding notifications or an automatic call to action.
- Promote notes to an idea or GitHub issue only through an explicit human action.

## Consequences

- The dashboard can remain agent-authored while the Logbook preserves human continuity.
- Backup/export belongs to Agent Zen because Codex and GitHub do not own this data.
- Search and grouping may span Logbook entries later, but agent mutation remains out of scope.

## Rejected alternatives

- **Put notes into the Codex prompt:** forces agent attention and changes the session.
- **Use GitHub/Jira comments:** durable but too public, remote, and action-oriented for local notes to self.
- **Let agents summarise the Logbook automatically:** blurs authorship and risks replacing the human record.
