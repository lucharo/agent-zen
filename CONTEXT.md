# Agent Zen

Agent Zen is a calm focus board for ideas and live agent sessions. It observes agent-owned state without requiring agents to maintain a separate workflow ledger.

## Language

**Focus item**:
An item shown on the board: either an Idea or a live Session.

**Idea**:
A human-authored item captured before an agent session exists.
_Avoid_: Backlog item, task

**Session**:
A live root agent conversation, including any child agents attached to it.
_Avoid_: Card, job

**Board state**:
The one mutually exclusive lane that best communicates a Focus item's present status.
_Avoid_: Stage, column type

**Ideas**:
The Board state for Ideas that have not become Sessions.
_Avoid_: Backlog

**Running**:
The Board state for a Session actively building or executing work outside Planning, Reviewing, or Wrapping up.
_Avoid_: Working

**Planning**:
The Board state for a Session whose agent is in plan mode.
_Avoid_: Planning / Idle, has a plan

**Idle**:
The Board state for a live Session with no active turn and no unresolved request for human input.
_Avoid_: Planning / Idle, inactive

**Needs you**:
The Board state for a Session with an unresolved request that requires human input or a human decision. It always wins the visible lane while the underlying workflow phase remains available as detail.
_Avoid_: Blocked

**Reviewing**:
The Board state for a Session while an explicitly invoked review turn is active. When that turn completes, the Session returns to Idle or Needs you.
_Avoid_: Review skill detected

**Wrapping up**:
The Board state for a Session while an explicitly invoked wrap-up turn is active.
_Avoid_: Finished, Done

**Wrapped up**:
The Board state for a Session whose wrap-up turn completed with no unresolved request while its process or thread remains open. The Session leaves the board when the process closes or the thread is archived.
_Avoid_: Done
