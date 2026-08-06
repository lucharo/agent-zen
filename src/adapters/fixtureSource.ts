import type { AgentSession, Plan, PlanRevision, PlanStep } from '@/domain/types'
import type { CodexSessionSource } from './CodexSessionSource'

const MINUTE = 60_000

const iso = (base: number, minutesAgo: number) => new Date(base - minutesAgo * MINUTE).toISOString()

const plan = (
  revision: number,
  updatedAt: string,
  explanation: string | null,
  steps: readonly [string, PlanStep['status']][],
): Plan => ({
  revision,
  updatedAt,
  explanation,
  steps: steps.map(([step, status]) => ({ step, status })),
})

/**
 * Realistic Codex thread state, shaped exactly like the records Codex persists.
 *
 * Covers every case the board has to render: all five stages, a plan that keeps
 * moving, superseded plan revisions, a child agent spawned by a running
 * session, three distinct projects with worktree and branch metadata, and one
 * ended thread so the archive route has something behind it.
 */
export function fixtureSessions(base: number): AgentSession[] {
  return [
    {
      id: 'sess-index-threads',
      threadId: '019e21c4-7a11-74b2-9c05-4a1f9e21ab30',
      title: 'Index local Codex threads',
      agent: 'codex',
      model: 'gpt-5.6-sol',
      createdAt: iso(base, 4),
      turnStartedAt: iso(base, 4),
      activity: 'working',
      parentSessionId: null,
      cwd: '/Users/demo/Projects/github.com/lucharo/agent-zen',
      repository: 'lucharo/agent-zen',
      branch: 'feat/thread-index',
      worktree: '~/Projects/github.com/lucharo/agent-zen',
      projectId: 'agent-zen',
      plan: null,
      planHistory: [],
      review: null,
      wrapup: null,
      endedAt: null,
    },
    {
      id: 'sess-control-plane',
      threadId: '019e21b0-3d54-7f18-8a77-1c0be4d2f905',
      title: 'Revise calm control plane',
      agent: 'codex',
      model: 'gpt-5.6-sol',
      createdAt: iso(base, 42),
      turnStartedAt: iso(base, 7),
      activity: 'working',
      parentSessionId: null,
      cwd: '/Users/demo/Projects/github.com/lucharo/agent-zen',
      repository: 'lucharo/agent-zen',
      branch: 'feat/codex-first-prototype',
      worktree: '~/.cache/openresearch/worktrees/local/agent-zen-codex-prototype',
      projectId: 'agent-zen',
      plan: plan(3, iso(base, 7), 'Board shell is in place; moving on to the card language.', [
        ['Read the CZ1 and CZ3 direction evidence', 'completed'],
        ['Set the token system and board shell', 'completed'],
        ['Generate three new mockups', 'in_progress'],
        ['Wire the quick capture sheet', 'pending'],
        ['Run visual QA at two viewports', 'pending'],
      ]),
      planHistory: [
        {
          revision: 1,
          updatedAt: iso(base, 39),
          explanation: 'First pass at scope.',
          steps: [
            { step: 'Read the CZ1 and CZ3 direction evidence', status: 'in_progress' },
            { step: 'Set the token system and board shell', status: 'pending' },
            { step: 'Generate three new mockups', status: 'pending' },
          ],
        },
        {
          revision: 2,
          updatedAt: iso(base, 24),
          explanation: 'Split the shell work; added a QA step.',
          steps: [
            { step: 'Read the CZ1 and CZ3 direction evidence', status: 'completed' },
            { step: 'Set the token system and board shell', status: 'in_progress' },
            { step: 'Generate three new mockups', status: 'pending' },
            { step: 'Wire the quick capture sheet', status: 'pending' },
            { step: 'Run visual QA at two viewports', status: 'pending' },
          ],
        },
      ],
      review: null,
      wrapup: null,
      endedAt: null,
    },
    {
      id: 'sess-fixture-sweep',
      threadId: '019e21bd-0c92-7440-b1e2-73a5c0e8d411',
      title: 'Sweep board fixtures into tests',
      agent: 'codex',
      model: 'gpt-5.6-sol',
      createdAt: iso(base, 11),
      turnStartedAt: iso(base, 2),
      activity: 'working',
      parentSessionId: 'sess-control-plane',
      cwd: '/Users/demo/Projects/github.com/lucharo/agent-zen',
      repository: 'lucharo/agent-zen',
      branch: 'feat/codex-first-prototype',
      worktree: '~/.cache/openresearch/worktrees/local/agent-zen-codex-prototype',
      projectId: 'agent-zen',
      plan: plan(1, iso(base, 9), null, [
        ['Collect the fixture shapes', 'completed'],
        ['Write derivation tests', 'in_progress'],
        ['Write interaction tests', 'pending'],
      ]),
      planHistory: [],
      review: null,
      wrapup: null,
      endedAt: null,
    },
    {
      id: 'sess-harbor-canary',
      threadId: '019e2103-8b6d-7e21-93af-55d0c1aa7712',
      title: 'Harbor canary review',
      agent: 'codex',
      model: 'gpt-5.6-sol',
      createdAt: iso(base, 128),
      turnStartedAt: iso(base, 19),
      activity: 'awaiting-input',
      parentSessionId: null,
      cwd: '/Users/demo/Projects/github.com/lucharo/acm',
      repository: 'lucharo/acm',
      branch: 'fix/canary-drift',
      worktree: '~/Projects/github.com/lucharo/acm',
      projectId: 'acm',
      plan: plan(4, iso(base, 19), 'Review requested; holding for notes.', [
        ['Reproduce the canary drift', 'completed'],
        ['Patch the threshold check', 'completed'],
        ['Open the PR', 'completed'],
        ['Address review notes', 'in_progress'],
      ]),
      planHistory: [],
      review: { visualChecked: true, prReady: true, openNotes: 3, pullRequest: 'lucharo/acm#212' },
      wrapup: null,
      endedAt: null,
    },
    {
      id: 'sess-retire-dask',
      threadId: '019e20a7-1f38-7c05-88bb-2e93f5417c60',
      title: 'Retire dask join helpers',
      agent: 'codex',
      model: 'gpt-5.6-sol',
      createdAt: iso(base, 214),
      turnStartedAt: iso(base, 3),
      activity: 'working',
      parentSessionId: null,
      cwd: '/Users/demo/Projects/github.com/example/data-pipeline',
      repository: 'example/data-pipeline',
      branch: 'chore/retire-dask-helpers',
      worktree: '~/Projects/github.com/example/data-pipeline',
      projectId: 'data-pipeline',
      plan: plan(6, iso(base, 3), 'Wrapup invoked; running the close-out checks.', [
        ['Replace the join helpers', 'completed'],
        ['Update the migration guide', 'completed'],
        ['Run the polars parity suite', 'completed'],
        ['Land the PR', 'in_progress'],
      ]),
      planHistory: [],
      review: null,
      wrapup: { checksPassed: 6, checksTotal: 7 },
      endedAt: null,
    },
    {
      id: 'sess-tool-update-docs',
      threadId: '019e1f52-6ac4-7bd9-a740-98c11e05b3d2',
      title: 'Tool update docs',
      agent: 'codex',
      model: 'gpt-5.6-sol',
      createdAt: iso(base, 1_460),
      turnStartedAt: null,
      activity: 'ended',
      parentSessionId: null,
      cwd: '/Users/demo/Projects/github.com/lucharo/agent-zen',
      repository: 'lucharo/agent-zen',
      branch: 'docs/tool-update',
      worktree: '~/Projects/github.com/lucharo/agent-zen',
      projectId: 'agent-zen',
      plan: plan(2, iso(base, 1_290), null, [
        ['Draft the reconcile section', 'completed'],
        ['Check every command end to end', 'completed'],
      ]),
      planHistory: [],
      review: null,
      wrapup: { checksPassed: 7, checksTotal: 7 },
      endedAt: iso(base, 1_288),
    },
  ]
}

/**
 * Advance the current plan of one session by one step, as a real `plan_update`
 * would: the whole plan is replaced and the previous revision moves to history.
 * Once the last step completes the plan wraps to a fresh revision, which is what
 * a long session actually looks like.
 */
export function advancePlan(session: AgentSession, at: string): AgentSession {
  const current = session.plan
  if (!current) return session

  const activeIndex = current.steps.findIndex((s) => s.status === 'in_progress')
  if (activeIndex === -1) return session

  const isLast = activeIndex === current.steps.length - 1
  const steps: PlanStep[] = current.steps.map((s, i) => {
    if (i === activeIndex) return { ...s, status: 'completed' }
    if (i === activeIndex + 1) return { ...s, status: 'in_progress' }
    return s
  })

  const history: PlanRevision[] = [
    ...session.planHistory,
    {
      revision: current.revision,
      updatedAt: current.updatedAt,
      explanation: current.explanation,
      steps: current.steps,
    },
  ]

  const next: Plan = isLast
    ? {
        revision: current.revision + 1,
        updatedAt: at,
        explanation: 'Plan replaced after the previous pass landed.',
        steps: current.steps.map((s, i) => ({ ...s, status: i === 0 ? 'in_progress' : 'pending' })),
      }
    : { ...current, revision: current.revision + 1, updatedAt: at, steps }

  // A plan revision is not a new turn. Keep the native turn start so the
  // "current turn" clock continues while Codex replaces its plan.
  return { ...session, plan: next, planHistory: history }
}

export interface FixtureSourceOptions {
  /** Epoch ms the fixture timeline is anchored to. Defaults to `Date.now()`. */
  now?: number
  /** How often a plan step advances. `0` disables ticking, which tests want. */
  tickMs?: number
  /** Sessions whose plan the ticker advances, in rotation. */
  tickingSessionIds?: readonly string[]
}

/**
 * Fixture-backed `CodexSessionSource`.
 *
 * Swapping this for the bundled Codex app-server is a same-shape replacement:
 * hold the thread list, push it to listeners when the protocol reports a
 * change, and keep `snapshot()` synchronous.
 */
export function createFixtureSessionSource(options: FixtureSourceOptions = {}): CodexSessionSource {
  const base = options.now ?? Date.now()
  const tickMs = options.tickMs ?? 12_000
  const ticking = options.tickingSessionIds ?? ['sess-control-plane', 'sess-fixture-sweep']

  let sessions = fixtureSessions(base)
  const listeners = new Set<(sessions: readonly AgentSession[]) => void>()
  let timer: ReturnType<typeof setInterval> | null = null
  let cursor = 0

  const emit = () => {
    for (const listener of listeners) listener(sessions)
  }

  const tick = () => {
    const id = ticking[cursor % ticking.length]
    cursor += 1
    if (!id) return
    const at = new Date().toISOString()
    sessions = sessions.map((s) => (s.id === id ? advancePlan(s, at) : s))
    emit()
  }

  const startIfNeeded = () => {
    if (timer || tickMs <= 0 || listeners.size === 0) return
    timer = setInterval(tick, tickMs)
  }

  const stopIfIdle = () => {
    if (timer && listeners.size === 0) {
      clearInterval(timer)
      timer = null
    }
  }

  return {
    agent: 'codex',
    snapshot: () => sessions,
    subscribe(listener) {
      listeners.add(listener)
      startIfNeeded()
      return () => {
        listeners.delete(listener)
        stopIfIdle()
      }
    },
  }
}
