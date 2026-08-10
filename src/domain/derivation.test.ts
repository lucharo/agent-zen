import { describe, expect, it } from 'vitest'
import { advancePlan, fixtureSessions } from '@/adapters/fixtureSource'
import { filterIdeas, groupIdeas } from '@/domain/ideas'
import {
  activeSessionCount,
  currentPlanStep,
  deriveStage,
  launchAvailability,
  planProgress,
} from '@/domain/stage'
import { dateBucket, formatDuration, formatSessionTiming } from '@/domain/time'
import type { AgentSession, Idea } from '@/domain/types'
import { SEED_PROJECTS, seedIdeas } from '@/state/seed'
import { STORAGE_KEY, createInitialState, loadState, saveState } from '@/state/persistence'
import { reducer } from '@/state/reducer'

const NOW = new Date('2026-08-06T11:00:00Z').getTime()
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const sessions = fixtureSessions(NOW)
const byId = (id: string): AgentSession => {
  const found = sessions.find((s) => s.id === id)
  if (!found) throw new Error(`fixture ${id} is missing`)
  return found
}

describe('deriveStage', () => {
  it('drops an ended session off the board rather than into a Done column', () => {
    expect(deriveStage(byId('sess-tool-update-docs'))).toBeNull()
  })

  it('places every live session from agent-reported state alone', () => {
    // No local placement exists: the board follows agent-reported state alone.
    expect(deriveStage(byId('sess-index-threads'))).toBe('planning')
    expect(deriveStage(byId('sess-control-plane'))).toBe('running')
    expect(deriveStage(byId('sess-harbor-canary'))).toBe('reviewing')
    expect(deriveStage(byId('sess-retire-dask'))).toBe('wrapping-up')
  })

  it('does not expose a local override path for agent-authored placement', () => {
    expect(deriveStage(byId('sess-control-plane'))).toBe('running')
  })

  it('moves planless sessions to Running once native agent work begins', () => {
    const planning = byId('sess-index-threads')
    expect(deriveStage({ ...planning, hasSubstantiveActivity: false })).toBe('planning')
    expect(deriveStage({ ...planning, hasSubstantiveActivity: true })).toBe('running')
  })

  it('moves non-progressing work out of Running while preserving review and wrap-up stages', () => {
    const running = byId('sess-control-plane')
    expect(deriveStage({ ...running, activity: 'idle' })).toBe('planning')
    expect(deriveStage({ ...running, activity: 'awaiting-input' })).toBe('planning')
    expect(deriveStage({ ...byId('sess-harbor-canary'), activity: 'idle' })).toBe('reviewing')
    expect(deriveStage({ ...byId('sess-retire-dask'), activity: 'idle' })).toBe('wrapping-up')
  })
})

describe('activeSessionCount', () => {
  it('counts root planning and running sessions only', () => {
    // Five session cards are on the board; two consume a slot. The child agent
    // runs inside its parent's, and reviewing/wrapping up wait on a human.
    expect(activeSessionCount(sessions, (s) => deriveStage(s))).toBe(2)
  })

  it('does not count a child agent separately from its parent', () => {
    const child = byId('sess-fixture-sweep')
    expect(child.parentSessionId).toBe('sess-control-plane')
    expect(activeSessionCount([child], (s) => deriveStage(s))).toBe(0)
  })
})

describe('launchAvailability', () => {
  it('allows launches while the focus limit is disabled', () => {
    expect(launchAvailability(9, false, 1)).toEqual({
      allowed: true,
      reason: 'limit-disabled',
    })
  })

  it('allows one more root session below the enabled limit', () => {
    expect(launchAvailability(2, true, 3)).toEqual({
      allowed: true,
      reason: 'slot-available',
    })
  })

  it('refuses only a new launch once the enabled limit is full', () => {
    expect(launchAvailability(3, true, 3)).toEqual({
      allowed: false,
      reason: 'limit-reached',
    })
  })
})

describe('plan reading', () => {
  it('reads a running session as on step N of M', () => {
    const running = byId('sess-control-plane')
    expect(currentPlanStep(running)).toBe('Generate three new mockups')
    expect(planProgress(running)).toEqual({ completed: 3, total: 5 })
  })

  it('has nothing to show while a plan is still pending', () => {
    const planning = byId('sess-index-threads')
    expect(planning.plan).toBeNull()
    expect(currentPlanStep(planning)).toBeNull()
    expect(planProgress(planning)).toBeNull()
  })
})

describe('advancePlan', () => {
  it('replaces the current plan and files the old revision in history', () => {
    const before = byId('sess-control-plane')
    const at = new Date(NOW + MINUTE).toISOString()
    const after = advancePlan(before, at)

    expect(after.plan?.revision).toBe((before.plan?.revision ?? 0) + 1)
    expect(after.planHistory).toHaveLength(before.planHistory.length + 1)
    expect(after.planHistory.at(-1)?.revision).toBe(before.plan?.revision)
    expect(currentPlanStep(after)).toBe('Wire the quick capture sheet')
    expect(after.turnStartedAt).toBe(before.turnStartedAt)
  })

  it('wraps to a fresh revision once the last step completes', () => {
    const start = byId('sess-fixture-sweep')
    const total = start.plan?.steps.length ?? 0
    const startIndex = (planProgress(start)?.completed ?? 1) - 1

    let session = start
    for (let i = 0; i < total - startIndex; i += 1) {
      session = advancePlan(session, new Date(NOW + i * MINUTE).toISOString())
    }

    // Back at step one of a higher revision: the plan is replaced wholesale,
    // never appended to, which is what "current plan" means for Codex.
    expect(planProgress(session)).toEqual({ completed: 1, total })
    expect(session.plan?.revision).toBeGreaterThan(start.plan?.revision ?? 0)
  })
})

describe('time formatting', () => {
  it('drops to the coarsest unit that still reads truthfully', () => {
    expect(formatDuration(48_000)).toBe('48s')
    expect(formatDuration(42 * MINUTE)).toBe('42m')
    expect(formatDuration(2 * HOUR + 14 * MINUTE)).toBe('2h 14m')
    expect(formatDuration(3 * HOUR)).toBe('3h')
  })

  it('labels both numbers on the session timing line', () => {
    const created = new Date(NOW - 42 * MINUTE).toISOString()
    const turn = new Date(NOW - 7 * MINUTE).toISOString()
    expect(formatSessionTiming(created, turn, NOW)).toBe('42m total · 7m current turn')
  })

  it('omits the turn when the session is between turns', () => {
    const created = new Date(NOW - 42 * MINUTE).toISOString()
    expect(formatSessionTiming(created, null, NOW)).toBe('42m total')
  })

  it('buckets capture dates by how a person would name them', () => {
    const at = (ms: number) => new Date(NOW - ms).toISOString()
    expect(dateBucket(at(HOUR), NOW)).toBe('today')
    expect(dateBucket(at(DAY), NOW)).toBe('yesterday')
    expect(dateBucket(at(40 * DAY), NOW)).toBe('older')
  })
})

describe('ideas', () => {
  const ideas = seedIdeas(NOW)

  it('groups by project and drops empty groups', () => {
    const groups = groupIdeas(ideas, { groupBy: 'project', projects: SEED_PROJECTS, now: NOW })
    expect(groups.every((group) => group.ideas.length > 0)).toBe(true)
    expect(groups.map((group) => group.label)).toContain('No project')
    expect(groups.reduce((n, group) => n + group.ideas.length, 0)).toBe(ideas.length)
  })

  it('groups by date newest first', () => {
    const groups = groupIdeas(ideas, { groupBy: 'created', projects: SEED_PROJECTS, now: NOW })
    expect(groups[0]?.key).toBe('today')
    expect(groups.every((group) => group.ideas.length > 0)).toBe(true)
  })

  it('filters by project and by free text across title and notes', () => {
    const sample: Idea[] = [
      {
        id: 'a',
        title: 'Map the worktree layout',
        notes: '',
        projectId: 'proj-agent-zen',
        repository: null,
        action: 'keep-idea',
        createdAt: new Date(NOW).toISOString(),
      },
      {
        id: 'b',
        title: 'Retire the old runner',
        notes: 'depends on the worktree map',
        projectId: 'proj-data-pipeline',
        repository: null,
        action: 'keep-idea',
        createdAt: new Date(NOW).toISOString(),
      },
    ]

    expect(filterIdeas(sample, { projectId: 'proj-data-pipeline' }).map((i) => i.id)).toEqual(['b'])
    expect(filterIdeas(sample, { query: 'worktree' }).map((i) => i.id)).toEqual(['a', 'b'])
    expect(filterIdeas(sample, { projectId: 'proj-agent-zen', query: 'runner' })).toEqual([])
  })
})

describe('persistence', () => {
  it('survives a save and load round trip', () => {
    const storage = window.localStorage
    const initial = createInitialState(NOW)
    const captured = reducer(initial, {
      type: 'capture-idea',
      now: NOW,
      draft: {
        title: 'Persist across a cold reload',
        notes: '',
        projectId: 'proj-agent-zen',
        repository: 'lucharo/agent-zen',
        action: 'keep-idea',
      },
    })
    const withNote = reducer(captured, {
      type: 'add-logbook-note',
      subjectId: 'sess-control-plane',
      body: 'Checked the plan by hand.',
      now: NOW,
    })

    saveState(storage, { ...withNote, theme: 'dark', view: 'ideas' })
    const loaded = loadState(storage, NOW)

    expect(loaded.theme).toBe('dark')
    expect(loaded.view).toBe('ideas')
    expect(loaded.activeLimitEnabled).toBe(false)
    expect(loaded.ideas[0]?.title).toBe('Persist across a cold reload')
    expect(loaded.logbook.at(-1)).toMatchObject({
      subjectId: 'sess-control-plane',
      body: 'Checked the plan by hand.',
      author: 'human',
    })
  })

  it('starts with an empty human-owned store', () => {
    const initial = createInitialState(NOW)

    expect(initial.projects).toEqual([])
    expect(initial.ideas).toEqual([])
    expect(initial.logbook).toEqual([])
    expect(initial.kanbanCardDetail).toBe('titles')
  })

  it('migrates older installs to compact cards once, then preserves the chosen detail', () => {
    const storage = window.localStorage
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...createInitialState(NOW), version: 2, kanbanCardDetail: 'details' }),
    )

    const migrated = loadState(storage, NOW)
    expect(migrated.version).toBe(4)
    expect(migrated.kanbanCardDetail).toBe('titles')

    saveState(storage, { ...migrated, kanbanCardDetail: 'details' })
    expect(loadState(storage, NOW).kanbanCardDetail).toBe('details')
  })

  it('removes old prototype ideas while preserving ideas captured by the user', () => {
    const storage = window.localStorage
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...createInitialState(NOW),
        version: 1,
        ideas: [
          ...seedIdeas(NOW),
          {
            id: 'idea-user-owned',
            title: 'Keep this idea',
            notes: 'Captured by the user.',
            projectId: null,
            repository: null,
            action: 'keep-idea',
            createdAt: new Date(NOW).toISOString(),
          },
        ],
      }),
    )

    const loaded = loadState(storage, NOW)

    expect(loaded.ideas.map((idea) => idea.title)).toEqual(['Keep this idea'])
  })

  it('registers projects once by local or GitHub identity', () => {
    const initial = createInitialState(NOW)
    const project = {
      id: 'proj-taskflow',
      name: 'taskflow',
      directory: '~/Projects/github.com/lucharo/taskflow',
      repository: 'lucharo/taskflow',
    }
    const once = reducer(initial, { type: 'add-projects', projects: [project] })
    const twice = reducer(once, { type: 'add-projects', projects: [project] })

    expect(once.projects).toHaveLength(initial.projects.length + 1)
    expect(twice.projects).toEqual(once.projects)
  })

  it('falls back to a fresh state when the stored blob is unreadable', () => {
    window.localStorage.setItem(STORAGE_KEY, '{ not json')
    expect(loadState(window.localStorage, NOW).projects).toEqual([])
  })
})

describe('project reconciliation', () => {
  it('does not remap an idea to an unrelated repository with the same directory name', () => {
    const previous = {
      id: 'old-tools',
      name: 'tools',
      directory: '/Users/test/Projects/github.com/first/tools',
      repository: 'first/tools',
    }
    const unrelated = {
      id: 'new-tools',
      name: 'tools',
      directory: '/Users/test/Projects/github.com/second/tools',
      repository: 'second/tools',
    }
    const state = {
      ...createInitialState(NOW),
      projects: [previous],
      projectFilter: previous.id,
      ideas: [{
        id: 'idea',
        title: 'Keep its identity',
        notes: '',
        projectId: previous.id,
        repository: previous.repository,
        action: 'keep-idea' as const,
        createdAt: new Date(NOW).toISOString(),
      }],
    }

    const reconciled = reducer(state, {
      type: 'sync-bridge-settings',
      projects: [unrelated],
      knownProjectIds: [unrelated.id],
      activeLimitEnabled: false,
      activeLimit: 3,
    })

    expect(reconciled.ideas[0]?.projectId).toBeNull()
    expect(reconciled.projectFilter).toBeNull()
  })
})

describe('logbook ownership', () => {
  it('stamps every note as human-authored and only ever appends', () => {
    const at = createInitialState(NOW)
    const one = reducer(at, {
      type: 'add-logbook-note',
      subjectId: 'idea-1',
      body: 'first',
      now: NOW,
    })
    const two = reducer(one, {
      type: 'add-logbook-note',
      subjectId: 'idea-1',
      body: 'second',
      now: NOW + MINUTE,
    })

    expect(two.logbook.map((n) => n.body)).toEqual([
      ...at.logbook.map((n) => n.body),
      'first',
      'second',
    ])
    expect(two.logbook.every((n) => n.author === 'human')).toBe(true)
  })
})
