import type { Idea, LogbookNote, Project } from '@/domain/types'

const HOUR = 3_600_000
const DAY = 24 * HOUR

const startOfDay = (now: number) => {
  const d = new Date(now)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/** Days back from today's midnight, then a wall-clock time inside that day. */
const at = (now: number, daysBack: number, hours: number, minutes: number) =>
  new Date(
    Math.min(startOfDay(now) - daysBack * DAY + hours * HOUR + minutes * 60_000, now - 60_000),
  ).toISOString()

export const SEED_PROJECTS: readonly Project[] = [
  {
    id: 'agent-zen',
    name: 'agent-zen',
    directory: '~/Projects/github.com/lucharo/agent-zen',
    repository: 'lucharo/agent-zen',
  },
  {
    id: 'data-pipeline',
    name: 'data-pipeline',
    directory: '~/Projects/github.com/example/data-pipeline',
    repository: 'example/data-pipeline',
  },
  {
    id: 'acm',
    name: 'acm',
    directory: '~/Projects/github.com/lucharo/acm',
    repository: 'lucharo/acm',
  },
]

interface SeedIdea {
  id: string
  title: string
  notes: string
  projectId: string | null
  daysBack: number
  hours: number
  minutes: number
}

const SEED_IDEA_SPECS: readonly SeedIdea[] = [
  {
    id: 'idea-session-dashboard',
    title: 'Session dashboard',
    notes: 'One quiet surface for what is actually running right now.',
    projectId: 'agent-zen',
    daysBack: 0,
    hours: 9,
    minutes: 41,
  },
  {
    id: 'idea-native-plan-reader',
    title: 'Native plan reader',
    notes: 'Read plan_update straight from the rollout file. No second ledger.',
    projectId: 'agent-zen',
    daysBack: 0,
    hours: 9,
    minutes: 17,
  },
  {
    id: 'idea-worktree-map',
    title: 'Codex worktree map',
    notes: 'Which worktree belongs to which thread, and which are stale.',
    projectId: 'agent-zen',
    daysBack: 0,
    hours: 8,
    minutes: 52,
  },
  {
    id: 'idea-batch-visual-review',
    title: 'Batch visual review',
    notes: 'Queue several sessions for one visual pass instead of one at a time.',
    projectId: 'agent-zen',
    daysBack: 1,
    hours: 16,
    minutes: 33,
  },
  {
    id: 'idea-register-personal-repos',
    title: 'Register personal repos',
    notes: 'Local directory plus GitHub repo, entered once, reused everywhere.',
    projectId: 'data-pipeline',
    daysBack: 1,
    hours: 14,
    minutes: 18,
  },
  {
    id: 'idea-quiet-session-limits',
    title: 'Quiet session limits',
    notes: 'Warn at the limit without turning the toolbar into a gauge.',
    projectId: 'agent-zen',
    daysBack: 1,
    hours: 10,
    minutes: 7,
  },
  {
    id: 'idea-pr-ready-checklist',
    title: 'PR-ready checklist',
    notes: 'Aggregate the signals that actually decide readiness.',
    projectId: 'agent-zen',
    daysBack: 2,
    hours: 15,
    minutes: 27,
  },
  {
    id: 'idea-auto-notes-summarizer',
    title: 'Auto notes summarizer',
    notes: 'Roll a long thread into three lines for the card.',
    projectId: 'acm',
    daysBack: 3,
    hours: 11,
    minutes: 2,
  },
  {
    id: 'idea-smart-context-picker',
    title: 'Smart context picker',
    notes: 'Pick the files a new session should start from.',
    projectId: 'data-pipeline',
    daysBack: 3,
    hours: 17,
    minutes: 45,
  },
  {
    id: 'idea-local-model-selector',
    title: 'Local model selector',
    notes: 'Choose the model at launch without editing config.toml.',
    projectId: 'agent-zen',
    daysBack: 8,
    hours: 16,
    minutes: 37,
  },
  {
    id: 'idea-review-summary-exporter',
    title: 'Review summary exporter',
    notes: 'Hand a review to a colleague as one readable page.',
    projectId: 'acm',
    daysBack: 9,
    hours: 13,
    minutes: 12,
  },
  {
    id: 'idea-archive-sweep',
    title: 'Archive sweep view',
    notes: 'Weekly pass over ended threads; keep what is worth keeping.',
    projectId: 'agent-zen',
    daysBack: 10,
    hours: 9,
    minutes: 5,
  },
  {
    id: 'idea-worktree-gc',
    title: 'Worktree garbage collector',
    notes: 'Remove worktrees whose branch has been merged and deleted.',
    projectId: 'data-pipeline',
    daysBack: 18,
    hours: 11,
    minutes: 40,
  },
  {
    id: 'idea-plan-drift-alerts',
    title: 'Plan drift alerts',
    notes: 'Notice when the plan is replaced three times in ten minutes.',
    projectId: 'agent-zen',
    daysBack: 22,
    hours: 15,
    minutes: 8,
  },
  {
    id: 'idea-idea-to-issue-batch',
    title: 'Idea to issue, in batches',
    notes: 'Triage a whole group into GitHub issues in one pass.',
    projectId: 'agent-zen',
    daysBack: 26,
    hours: 10,
    minutes: 21,
  },
  {
    id: 'idea-keyboard-only-board',
    title: 'Keyboard-only board',
    notes: 'Reach every card and every action without the trackpad.',
    projectId: 'agent-zen',
    daysBack: 44,
    hours: 14,
    minutes: 3,
  },
  {
    id: 'idea-session-cost-ledger',
    title: 'Session cost ledger',
    notes: 'Token spend per thread, read from token_count events.',
    projectId: null,
    daysBack: 58,
    hours: 12,
    minutes: 30,
  },
  {
    id: 'idea-repo-registration-import',
    title: 'Repo registration import',
    notes: 'Seed the project registry from ~/Projects in one go.',
    projectId: 'acm',
    daysBack: 71,
    hours: 9,
    minutes: 55,
  },
]

export function seedIdeas(now: number): Idea[] {
  const byId = new Map(SEED_PROJECTS.map((p) => [p.id, p]))
  return SEED_IDEA_SPECS.map((spec) => ({
    id: spec.id,
    title: spec.title,
    notes: spec.notes,
    projectId: spec.projectId,
    repository: spec.projectId ? (byId.get(spec.projectId)?.repository ?? null) : null,
    action: 'keep-idea' as const,
    createdAt: at(now, spec.daysBack, spec.hours, spec.minutes),
  }))
}

/** Pre-written by the human, never by an agent — that is the whole point. */
export function seedLogbook(now: number): LogbookNote[] {
  return [
    {
      id: 'note-control-plane-1',
      subjectId: 'sess-control-plane',
      body: 'Board shell is right. The card is still doing too much — cut the second time line and keep the labelled one.',
      createdAt: new Date(now - 34 * 60_000).toISOString(),
      author: 'human',
    },
    {
      id: 'note-control-plane-2',
      subjectId: 'sess-control-plane',
      body: 'Decision: no Done column. Finished work goes quiet, it does not pile up in the focus surface.',
      createdAt: new Date(now - 12 * 60_000).toISOString(),
      author: 'human',
    },
    {
      id: 'note-harbor-canary-1',
      subjectId: 'sess-harbor-canary',
      body: 'Three review notes are mine, not the agent’s. Hold the merge until I have read the diff myself.',
      createdAt: new Date(now - 18 * 60_000).toISOString(),
      author: 'human',
    },
    {
      id: 'note-worktree-map-1',
      subjectId: 'idea-worktree-map',
      body: 'Only worth building once the archive route exists — otherwise it is a map of nothing.',
      createdAt: new Date(now - 5 * HOUR).toISOString(),
      author: 'human',
    },
  ]
}
