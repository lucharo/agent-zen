/**
 * Agent Zen domain model.
 *
 * The model has two halves and the split is load-bearing:
 *
 *  - `AgentSession` and everything reachable from it is **agent-derived and
 *    read-only**. It mirrors what Codex already persists (thread, turn, plan,
 *    parent/child, cwd, worktree, branch, model). Agent Zen never writes here
 *    and never asks an agent to maintain a second ledger.
 *  - `Idea`, `Project` and `LogbookNote` are **Agent Zen-owned and locally
 *    persisted**. They are ours to mutate.
 */

/** The five board stages. There is deliberately no `done`. */
export type Stage = 'ideas' | 'planning' | 'running' | 'reviewing' | 'wrapping-up'

export const STAGES: readonly Stage[] = [
  'ideas',
  'planning',
  'running',
  'reviewing',
  'wrapping-up',
] as const

export const STAGE_LABELS: Record<Stage, string> = {
  ideas: 'Ideas',
  planning: 'Planning',
  running: 'Running',
  reviewing: 'Reviewing',
  'wrapping-up': 'Wrapping up',
}

/** Stages backed by a live agent session. `ideas` is ours, so it carries no mark. */
export const SESSION_STAGES: readonly Exclude<Stage, 'ideas'>[] = [
  'planning',
  'running',
  'reviewing',
  'wrapping-up',
] as const

// ---------------------------------------------------------------------------
// Agent-derived, read-only
// ---------------------------------------------------------------------------

/** Mirrors the Codex `update_plan` step statuses exactly. */
export type PlanStepStatus = 'pending' | 'in_progress' | 'completed'

export interface PlanStep {
  readonly step: string
  readonly status: PlanStepStatus
}

/**
 * The native plan is *current*, not accumulated: each `plan_update` replaces the
 * whole list. `revision` and `updatedAt` let the UI show that it moved without
 * inventing a second history.
 */
export interface Plan {
  readonly revision: number
  readonly updatedAt: string
  readonly explanation: string | null
  readonly steps: readonly PlanStep[]
}

/** One superseded plan revision, kept only so the detail surface can show drift. */
export interface PlanRevision {
  readonly revision: number
  readonly updatedAt: string
  readonly explanation: string | null
  readonly steps: readonly PlanStep[]
}

export type SessionActivity = 'idle' | 'working' | 'awaiting-input' | 'ended'

/** Read-only review signals. Aggregated, never a CI dashboard. */
export interface ReviewSignals {
  readonly visualChecked: boolean | null
  readonly prReady: boolean | null
  readonly openNotes: number | null
  readonly pullRequest: string | null
}

/** Read-only wrapup progress, sourced from the wrapup skill's own checks. */
export interface WrapupSignals {
  readonly checksPassed: number | null
  readonly checksTotal: number | null
}

export type SessionRequestId = number | string

export interface SessionRequestQuestion {
  readonly id: string
  readonly header: string
  readonly question: string
  readonly isOther: boolean
  readonly isSecret: boolean
  readonly options: readonly {
    readonly label: string
    readonly description: string
  }[] | null
}

export type SessionApprovalDecision = 'accept' | 'acceptForSession' | 'decline' | 'cancel'

export type PendingSessionRequest =
  | {
      readonly kind: 'user-input'
      readonly requestId: SessionRequestId
      readonly questions: readonly SessionRequestQuestion[]
    }
  | {
      readonly kind: 'approval'
      readonly requestId: SessionRequestId
      readonly approval: 'command' | 'file' | 'legacy-command' | 'legacy-file'
      readonly title: string
      readonly detail: string | null
      readonly reason: string | null
      readonly availableDecisions: readonly SessionApprovalDecision[]
    }
  | {
      readonly kind: 'permissions'
      readonly requestId: SessionRequestId
      readonly title: string
      readonly reason: string | null
      readonly requestedPermissions: Readonly<Record<string, unknown>>
    }
  | {
      readonly kind: 'unsupported'
      readonly requestId: SessionRequestId
      readonly title: string
      readonly detail: string | null
    }

export interface AgentSession {
  readonly id: string
  /** Codex `session_meta.id`, i.e. the rollout thread id. */
  readonly threadId: string
  readonly title: string
  readonly agent: 'codex'
  /** Whether Agent Zen owns the controlling app-server connection for this thread. */
  readonly source: 'owned' | 'external'
  readonly model: string
  readonly reasoningEffort: string | null
  readonly cliVersion: string | null
  /** ISO timestamp of `session_meta`. Drives "time since session creation". */
  readonly createdAt: string
  /** ISO timestamp of the current turn's `task_started`. */
  readonly turnStartedAt: string | null
  readonly turnId: string | null
  readonly activity: SessionActivity
  /** True once the current/latest turn emits assistant output or invokes a tool. */
  readonly hasSubstantiveActivity: boolean
  /** Set when this session was spawned by another session. */
  readonly parentSessionId: string | null
  /** Codex `session_meta.cwd`. */
  readonly cwd: string
  readonly repository: string | null
  readonly branch: string | null
  readonly worktree: string | null
  /** Agent Zen project id, resolved from `cwd` against the project registry. */
  readonly projectId: string | null
  readonly plan: Plan | null
  readonly planHistory: readonly PlanRevision[]
  readonly review: ReviewSignals | null
  readonly wrapup: WrapupSignals | null
  /** Present only for an Agent Zen-owned app-server request awaiting a human response. */
  readonly pendingRequest?: PendingSessionRequest | null
  /** Set once the owning Codex process is gone; ended sessions leave the focus board. */
  readonly endedAt: string | null
}

// ---------------------------------------------------------------------------
// Agent Zen-owned, locally persisted
// ---------------------------------------------------------------------------

export interface Project {
  readonly id: string
  readonly name: string
  /** Local main repository directory. */
  readonly directory: string
  /** `owner/repo` on GitHub. */
  readonly repository: string | null
}

/** What quick capture should do once the sheet is saved. None launches by default. */
export type CaptureAction = 'keep-idea' | 'github-issue' | 'launch-session'

export interface Idea {
  readonly id: string
  readonly title: string
  readonly notes: string
  readonly projectId: string | null
  readonly repository: string | null
  readonly action: CaptureAction
  readonly createdAt: string
}

/**
 * Human-only, append-only. Agents never author or mutate a Logbook note; there
 * is deliberately no edit or delete path and no agent-writable field.
 */
export interface LogbookNote {
  readonly id: string
  /** A session id or an idea id. */
  readonly subjectId: string
  readonly body: string
  readonly createdAt: string
  readonly author: 'human'
}

export type ThemeChoice = 'system' | 'light' | 'dark'
export type IdeaGroupBy = 'created' | 'project'
export type IdeaLayout = 'grid' | 'list'
export type SessionLayout = 'kanban' | 'grid'
export type KanbanGroupBy = 'none' | 'project'
export type KanbanCardDetail = 'titles' | 'details'
export type View = 'kanban' | 'ideas'
