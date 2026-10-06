import { describe, expect, it } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from '@/App'
import { createFixtureSessionSource } from '@/adapters/fixtureSource'
import type { AgentZenBridge } from '@/bridge/httpBridge'
import type { BridgeSnapshot } from '@/bridge/types'
import { selectUiPreferences, type UiPreferences } from '@/domain/preferences'
import { STORAGE_KEY, createInitialState } from '@/state/persistence'
import { SEED_PROJECTS, seedIdeas, seedLogbook } from '@/state/seed'
import { AgentZenProvider } from '@/state/store'
import { createMemoryStorage } from '@/test/memoryStorage'

const NOW = new Date('2026-08-06T11:00:00Z').getTime()

/** A frozen clock and a non-ticking source, so nothing moves mid-assertion. */
function mount(storage: Storage = createMemoryStorage()) {
  seedTestState(storage)
  const view = render(
    <AgentZenProvider
      source={createFixtureSessionSource({ now: NOW, tickMs: 0 })}
      now={NOW}
      storage={storage}
    >
      <App />
    </AgentZenProvider>,
  )
  return { ...view, storage, user: userEvent.setup({ document }) }
}

function seedTestState(storage: Storage): Storage {
  if (!storage.getItem(STORAGE_KEY)) {
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...createInitialState(NOW),
        projects: SEED_PROJECTS,
        ideas: seedIdeas(NOW),
        logbook: seedLogbook(NOW),
      }),
    )
  }
  return storage
}

const column = (name: string) => screen.getByRole('region', { name })

const disconnectedSnapshot: BridgeSnapshot = {
  protocolVersion: 11,
  generatedAt: new Date().toISOString(),
  connection: { connected: false, label: 'Unavailable', userAgent: null, error: 'offline' },
  backends: [],
  sessions: [],
  focus: {
    enabled: false,
    limit: 3,
    activeCount: 0,
    availability: { allowed: true, reason: 'limit-disabled' },
  },
  preferences: null,
  projects: [],
  projectCandidates: [],
}

function disconnectedBridge(): AgentZenBridge {
  return {
    mode: 'live',
    snapshot: () => disconnectedSnapshot,
    subscribe: (listener) => {
      listener(disconnectedSnapshot)
      return () => undefined
    },
    refresh: async () => disconnectedSnapshot,
    setFocus: async () => disconnectedSnapshot,
    setPreferences: async () => disconnectedSnapshot,
    registerProjects: async () => disconnectedSnapshot,
    launch: async () => {
      throw new Error('offline')
    },
    interrupt: async () => undefined,
    steer: async () => undefined,
    respond: async () => undefined,
  }
}

function pendingBridge(): AgentZenBridge {
  return {
    ...disconnectedBridge(),
    subscribe: () => () => undefined,
  }
}

function preferenceBridge(preferences: UiPreferences, connected = true) {
  const writes: UiPreferences[] = []
  const listeners = new Set<(snapshot: BridgeSnapshot) => void>()
  let writeFailures = 0
  let snapshot: BridgeSnapshot = {
    ...disconnectedSnapshot,
    connection: connected
      ? { connected: true, label: 'Live Codex', userAgent: 'test', error: null }
      : disconnectedSnapshot.connection,
    preferences: selectUiPreferences(preferences),
  }
  const bridge: AgentZenBridge = {
    ...disconnectedBridge(),
    snapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      listener(snapshot)
      return () => listeners.delete(listener)
    },
    refresh: async () => snapshot,
    setPreferences: async (next) => {
      writes.push(next)
      if (writeFailures > 0) {
        writeFailures -= 1
        throw new Error('temporary settings failure')
      }
      snapshot = { ...snapshot, preferences: next }
      return snapshot
    },
  }
  return {
    bridge,
    writes,
    emit(next: UiPreferences) {
      snapshot = {
        ...snapshot,
        preferences: selectUiPreferences(next),
        generatedAt: new Date().toISOString(),
      }
      for (const listener of listeners) listener(snapshot)
    },
    failNextWrite() {
      writeFailures += 1
    },
  }
}

describe('the board', () => {
  it('shows a quiet connection state instead of flashing fixture sessions', () => {
    render(
      <AgentZenProvider
        bridge={pendingBridge()}
        source={createFixtureSessionSource({ now: NOW, tickMs: 0 })}
        now={NOW}
        storage={seedTestState(createMemoryStorage())}
      >
        <App />
      </AgentZenProvider>,
    )

    expect(screen.getByRole('status')).toHaveTextContent('Connecting to your agents')
    expect(screen.queryByText('Revise calm control plane')).toBeNull()
  })

  it('keeps local ideas and project links while the live bridge is still unavailable', () => {
    render(
      <AgentZenProvider
        bridge={disconnectedBridge()}
        source={createFixtureSessionSource({ now: NOW, tickMs: 0 })}
        now={NOW}
        storage={seedTestState(createMemoryStorage())}
      >
        <App />
      </AgentZenProvider>,
    )

    expect(
      within(column('Ideas')).getByRole('button', { name: /Session dashboard agent-zen/ }),
    ).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('offline')

    fireEvent.keyDown(window, { key: ',', metaKey: true })
    const settings = screen.getByRole('dialog', { name: 'Settings' })
    expect(settings).toBeInTheDocument()
    expect(screen.getAllByRole('alert')).toHaveLength(1)
  })

  it('shows Ideas plus the seven ordered session lanes and collapses empty lanes', () => {
    mount()

    for (const name of ['Ideas', 'Planning', 'Idle', 'Running', 'Needs you', 'Reviewing', 'Wrapping up', 'Wrapped up']) {
      expect(column(name)).toBeInTheDocument()
    }

    expect(column('Needs you')).toHaveAttribute('data-empty', 'false')
    expect(column('Reviewing')).toHaveAttribute('data-empty', 'true')
    expect(within(column('Reviewing')).queryByText('Nothing to review')).toBeNull()
    expect(within(column('Reviewing')).getByRole('button', { name: 'Expand Reviewing' }))
      .toBeDisabled()
    expect(within(column('Reviewing')).getByRole('button', { name: 'Expand Reviewing' }))
      .toHaveAttribute('title', 'Reviewing is empty')
    expect(column('Reviewing').querySelector('svg.lucide-chevron-right')).toBeNull()

    // Each card carries its own agent mark (ADR-0009); column titles and Ideas carry none.
    const runningHeader = column('Running').querySelector('header')
    expect(runningHeader).not.toBeNull()
    expect(within(runningHeader as HTMLElement).queryByText('Codex')).toBeNull()
    expect(within(column('Ideas')).queryByText('Codex')).toBeNull()
    const board = screen.getByRole('main')
    expect(within(board).getAllByText('Codex').length).toBeGreaterThan(0)
    expect(within(board).getAllByText('Claude Code').length).toBeGreaterThan(0)
  })

  it('places each fixture session in the column its own state implies', () => {
    mount()

    expect(within(column('Planning')).getByText('Index local Codex threads')).toBeInTheDocument()
    expect(within(column('Running')).getByText('Revise calm control plane')).toBeInTheDocument()
    expect(within(column('Needs you')).getByText('Harbor canary review')).toBeInTheDocument()
    expect(within(column('Needs you')).getByText('Reviewing · acm')).toBeInTheDocument()
    expect(within(column('Reviewing')).queryByText('Harbor canary review')).toBeNull()
    expect(within(column('Running')).queryByText(/Generate three new mockups/)).toBeNull()
    expect(within(column('Running')).getByText('42m total · 7m current turn')).toBeInTheDocument()
    expect(within(column('Running')).getByText('3 / 5')).toBeInTheDocument()
    expect(
      within(column('Running')).queryByRole('button', {
        name: /Sweep board fixtures into tests/,
      }),
    ).toBeNull()
    expect(within(column('Running')).getByText('1 subagent')).toBeInTheDocument()
  })

  it('can hide collapsed lanes and disable the Needs you lane highlight', async () => {
    const { user } = mount()
    expect(column('Needs you')).toHaveAttribute('data-highlight', 'true')
    expect(column('Ideas').parentElement).toHaveAttribute('data-constrain-width', 'true')

    await user.keyboard('{Meta>},{/Meta}')
    const settings = screen.getByRole('dialog', { name: 'Settings' })
    await user.click(within(settings).getByRole('switch', { name: 'Show collapsed lanes' }))
    await user.click(within(settings).getByRole('switch', { name: 'Highlight Needs you' }))
    await user.click(within(settings).getByRole('switch', { name: 'Constrain column width' }))
    await user.click(within(settings).getByRole('button', { name: 'Close settings' }))

    expect(screen.queryByRole('region', { name: 'Idle' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Reviewing' })).toBeNull()
    expect(column('Needs you')).toHaveAttribute('data-highlight', 'false')
    expect(column('Ideas').parentElement).toHaveAttribute('data-constrain-width', 'false')

    await user.click(within(column('Planning')).getByRole('button', { name: 'Collapse Planning' }))
    expect(screen.queryByRole('region', { name: 'Planning' })).toBeNull()
  })

  it('counts only the sessions that hold a slot', () => {
    mount()
    // The focus limit starts disabled even though two root sessions are active.
    expect(screen.getByRole('button', { name: /Limit off/ })).toBeInTheDocument()
  })

  it('folds the Ideas column down to a count', async () => {
    const { user } = mount()
    const ideas = column('Ideas')
    expect(within(ideas).getByText('Session dashboard')).toBeInTheDocument()

    await user.click(within(ideas).getByRole('button', { expanded: true }))

    expect(within(column('Ideas')).queryByText('Session dashboard')).toBeNull()
    expect(within(column('Ideas')).getByText(`${seedIdeas(NOW).length} ideas`)).toBeInTheDocument()
    expect(within(column('Ideas')).getByRole('button', { name: 'Ideas', expanded: false })).toHaveAttribute(
      'title',
      'Expand Ideas',
    )
  })

  it('folds, persists, and restores a populated session lane', async () => {
    const storage = createMemoryStorage()
    const first = mount(storage)
    const { user } = first
    const planning = column('Planning')
    expect(within(planning).getByText('Index local Codex threads')).toBeInTheDocument()

    await user.click(within(planning).getByRole('button', {
      name: 'Collapse Planning',
      expanded: true,
    }))

    expect(column('Planning')).toHaveAttribute('data-folded', 'true')
    expect(within(column('Planning')).queryByText('Index local Codex threads')).toBeNull()

    first.unmount()
    mount(storage)
    expect(column('Planning')).toHaveAttribute('data-folded', 'true')

    await user.click(within(column('Planning')).getByRole('button', {
      name: 'Expand Planning',
      expanded: false,
    }))

    expect(within(column('Planning')).getByText('Index local Codex threads')).toBeInTheDocument()
  })

  it('does not invent a history count from the observer window', () => {
    mount()
    expect(screen.queryByRole('region', { name: 'Done' })).toBeNull()
    expect(screen.queryByText(/finished sessions? in history/)).toBeNull()
  })
})

describe('navigation', () => {
  it('loads UI preferences from the bridge and writes changes back without browser-owned settings', async () => {
    const storage = createMemoryStorage()
    const { bridge, writes } = preferenceBridge({
      theme: 'dark',
      view: 'ideas',
      projectFilter: null,
      ideaGroupBy: 'project',
      ideaLayout: 'list',
      sessionLayout: 'grid',
      kanbanGroupBy: 'project',
      kanbanCardDetail: 'details',
      ideasFolded: true,
      foldedSessionLanes: ['planning'],
      showCollapsedLanes: false,
      highlightNeedsYou: false,
      constrainBoardWidth: false,
      visibleAgents: ['codex', 'claude'],
    })
    const user = userEvent.setup({ document })
    render(
      <AgentZenProvider bridge={bridge} now={NOW} storage={storage}>
        <App />
      </AgentZenProvider>,
    )

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Ideas' })).toHaveAttribute('aria-selected', 'true')
      expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    })

    await user.click(screen.getByRole('button', { name: /Theme: Dark/ }))
    await waitFor(() => expect(writes.at(-1)?.theme).toBe('system'))

    const browserState = JSON.parse(storage.getItem(STORAGE_KEY) ?? '{}') as Record<string, unknown>
    expect(browserState.theme).toBeUndefined()
    expect(browserState.view).toBeUndefined()
  })

  it('migrates existing browser preferences into bridge settings once', async () => {
    const storage = createMemoryStorage()
    storage.setItem(STORAGE_KEY, JSON.stringify({
      ...createInitialState(NOW),
      theme: 'dark',
      view: 'ideas',
      sessionLayout: 'grid',
      kanbanCardDetail: 'details',
    }))
    const { bridge, writes } = preferenceBridge({
      ...createInitialState(NOW),
      projectFilter: null,
    })
    const emptySnapshot = { ...bridge.snapshot(), preferences: null }
    const migratingBridge: AgentZenBridge = {
      ...bridge,
      snapshot: () => emptySnapshot,
      subscribe: (listener) => {
        listener(emptySnapshot)
        return () => undefined
      },
    }

    render(
      <AgentZenProvider bridge={migratingBridge} now={NOW} storage={storage}>
        <App />
      </AgentZenProvider>,
    )

    await waitFor(() => expect(writes).toHaveLength(1))
    expect(writes[0]).toMatchObject({
      theme: 'dark',
      view: 'ideas',
      sessionLayout: 'grid',
      kanbanCardDetail: 'details',
    })
  })

  it('persists human-owned ideas while preference migration is still pending', async () => {
    const storage = createMemoryStorage()
    storage.setItem(STORAGE_KEY, JSON.stringify(createInitialState(NOW)))
    const emptySnapshot = { ...disconnectedSnapshot, preferences: null }
    const bridge: AgentZenBridge = {
      ...disconnectedBridge(),
      snapshot: () => emptySnapshot,
      subscribe: (listener) => {
        listener(emptySnapshot)
        return () => undefined
      },
      setPreferences: () => new Promise(() => undefined),
    }
    const user = userEvent.setup({ document })
    const view = render(
      <AgentZenProvider bridge={bridge} now={NOW} storage={storage}>
        <App />
      </AgentZenProvider>,
    )

    await user.keyboard('c')
    const sheet = screen.getByRole('dialog', { name: 'Quick capture' })
    await user.type(within(sheet).getByLabelText('Title'), 'Persist during migration')
    await user.click(within(sheet).getByRole('button', { name: 'Save' }))

    view.unmount()
    expect(storage.getItem(STORAGE_KEY)).toContain('Persist during migration')
  })

  it('hydrates preferences even while Codex itself is disconnected', async () => {
    const { bridge } = preferenceBridge({
      ...createInitialState(NOW),
      theme: 'dark',
      view: 'ideas',
      projectFilter: null,
    }, false)
    render(
      <AgentZenProvider bridge={bridge} now={NOW} storage={createMemoryStorage()}>
        <App />
      </AgentZenProvider>,
    )

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Ideas' })).toHaveAttribute('aria-selected', 'true')
      expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    })
  })

  it('accepts preference changes from another Agent Zen window without writing them back', async () => {
    const initial = {
      ...createInitialState(NOW),
      projectFilter: null,
    }
    const { bridge, emit, writes } = preferenceBridge(initial)
    render(
      <AgentZenProvider bridge={bridge} now={NOW} storage={createMemoryStorage()}>
        <App />
      </AgentZenProvider>,
    )
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Sessions' })).toHaveAttribute('aria-selected', 'true'))

    act(() => emit({ ...initial, theme: 'dark', view: 'ideas', sessionLayout: 'grid' }))

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Ideas' })).toHaveAttribute('aria-selected', 'true')
      expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    })
    expect(writes).toEqual([])
  })

  it('retries a transient preference write without losing the visible choice', async () => {
    const initial = {
      ...createInitialState(NOW),
      projectFilter: null,
    }
    const { bridge, writes, failNextWrite } = preferenceBridge(initial)
    failNextWrite()
    const user = userEvent.setup({ document })
    render(
      <AgentZenProvider bridge={bridge} now={NOW} storage={createMemoryStorage()}>
        <App />
      </AgentZenProvider>,
    )
    await waitFor(() => expect(screen.getByRole('button', { name: /Theme: System/ })).toBeVisible())

    await user.click(screen.getByRole('button', { name: /Theme: System/ }))

    expect(screen.getByRole('button', { name: /Theme: Light/ })).toBeVisible()
    await waitFor(() => expect(writes).toHaveLength(2), { timeout: 2_500 })
    expect(writes.at(-1)?.theme).toBe('light')
  })

  it('reveals contextual shortcut hints while Command is held', () => {
    mount()

    const toolbar = screen.getByRole('banner', { name: 'Agent Zen toolbar' })
    expect(toolbar).toHaveAttribute('data-shortcuts', 'false')

    fireEvent.keyDown(window, { key: 'Meta', metaKey: true })
    expect(toolbar).toHaveAttribute('data-shortcuts', 'true')
    expect(within(toolbar).getByText('⌘K')).toBeInTheDocument()
    expect(within(toolbar).getByText('C')).toBeInTheDocument()
    fireEvent.keyUp(window, { key: 'Meta' })
    expect(toolbar).toHaveAttribute('data-shortcuts', 'false')
  })

  it('switches between Sessions and Ideas', async () => {
    const { user } = mount()
    const tabs = screen.getByRole('tablist', { name: 'View' })

    expect(within(tabs).getByRole('tab', { name: 'Sessions' })).toHaveAttribute(
      'aria-selected',
      'true',
    )

    await user.click(within(tabs).getByText('Ideas'))

    expect(screen.queryByRole('region', { name: 'Running' })).toBeNull()
    expect(within(tabs).getByText('Ideas')).toHaveAttribute('aria-selected', 'true')
  })

  it('opens the command palette on cmd+k and runs a command', async () => {
    const { user } = mount()

    await user.keyboard('{Meta>}k{/Meta}')
    const palette = screen.getByRole('dialog', { name: 'Command palette' })
    expect(within(palette).getByText('C')).toBeInTheDocument()
    expect(within(palette).getByText('⌘,')).toBeInTheDocument()
    await user.type(within(palette).getByLabelText('Search or jump to'), 'ideas')
    await user.keyboard('{Enter}')

    expect(screen.queryByRole('region', { name: 'Running' })).toBeNull()
  })

  it('opens Settings on cmd+comma', async () => {
    const { user } = mount()

    await user.keyboard('{Meta>},{/Meta}')

    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByText('Fixture data')).toBeInTheDocument()
  })

  it('opens capture when the native shell dispatches Command-N', () => {
    mount()

    fireEvent(window, new Event('agent-zen:new-idea'))

    expect(screen.getByRole('dialog', { name: 'Quick capture' })).toBeInTheDocument()
  })

  it('renders only quick capture for the native global-shortcut surface', () => {
    window.history.replaceState(null, '', '/?surface=quick-capture')
    try {
      mount()

      expect(screen.getByRole('dialog', { name: 'Quick capture' })).toBeInTheDocument()
      expect(screen.queryByRole('region', { name: 'Running' })).toBeNull()
      expect(screen.queryByRole('button', { name: /Sessions/ })).toBeNull()
    } finally {
      window.history.replaceState(null, '', '/')
    }
  })

  it('does not open a second modal from a global shortcut', async () => {
    const { user } = mount()

    await user.keyboard('{Meta>},{/Meta}')
    expect(screen.getAllByRole('dialog')).toHaveLength(1)

    await user.keyboard('c')

    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(screen.queryByRole('dialog', { name: 'Quick capture' })).toBeNull()
  })

  it('cycles theme from one toolbar control', async () => {
    const { user } = mount()
    const theme = screen.getByRole('button', { name: /Theme: System/ })

    await user.click(theme)

    expect(screen.getByRole('button', { name: /Theme: Light/ })).toBeInTheDocument()
  })

  it('filters the board and the backlog by project', async () => {
    const { user } = mount()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Filter by project' }), 'acm')

    expect(within(column('Needs you')).getByText('Harbor canary review')).toBeInTheDocument()
    expect(column('Running')).toHaveAttribute('data-empty', 'true')
    expect(within(column('Running')).queryByText('Nothing in flight')).toBeNull()
  })

  it('toggles the backlog between grid and list', async () => {
    const { user } = mount()
    await user.click(within(screen.getByRole('tablist', { name: 'View' })).getByText('Ideas'))

    const layout = screen.getByRole('group', { name: 'Layout' })
    expect(screen.getAllByRole('list')[0]).toHaveAttribute('data-layout', 'grid')

    await user.click(within(layout).getByRole('button', { name: 'List' }))

    expect(screen.getAllByRole('list')[0]).toHaveAttribute('data-layout', 'list')
  })

  it('keeps titles and goals visible while Description and Comments are cumulative card fields', async () => {
    const { user } = mount()
    const runningCard = within(column('Running')).getByRole('button', {
      name: /Revise calm control plane/,
    })

    expect(screen.queryByRole('combobox', { name: 'Session card detail' })).toBeNull()
    expect(within(runningCard).getByText('agent-zen')).toBeInTheDocument()
    expect(within(runningCard).getByText('42m total · 7m current turn')).toBeInTheDocument()
    expect(within(runningCard).getByText('3 / 5')).toBeInTheDocument()
    expect(within(runningCard).getByLabelText(
      'Goal active: Turn Agent Zen into a calm, reliable session control plane.',
    )).toBeInTheDocument()
    expect(within(column('Running')).queryByText('Generate three new mockups')).toBeNull()
    expect(within(column('Running')).queryByText(/Decision: no Done column/)).toBeNull()

    const fields = screen.getByRole('group', { name: 'Card fields' })
    expect(within(fields).getByRole('button', { name: 'Title, always shown' })).toBeDisabled()
    expect(within(fields).getByRole('button', { name: 'Description' })).toHaveAttribute('aria-pressed', 'false')
    expect(within(fields).getByRole('button', { name: 'Comments' })).toHaveAttribute('aria-pressed', 'false')

    await user.click(within(fields).getByRole('button', { name: 'Comments' }))

    expect(within(column('Running')).getByText('Generate three new mockups')).toBeInTheDocument()
    expect(within(column('Planning')).getByText('Planning · plan mode')).toBeInTheDocument()
    expect(within(column('Running')).getByText(/Decision: no Done column/)).toBeInTheDocument()
    expect(within(fields).getByRole('button', { name: 'Description' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(fields).getByRole('button', { name: 'Comments' })).toHaveAttribute('aria-pressed', 'true')

    await user.click(within(fields).getByRole('button', { name: 'Description' }))

    expect(within(column('Running')).getByText('42m total · 7m current turn')).toBeInTheDocument()
    expect(within(column('Running')).queryByText('Generate three new mockups')).toBeNull()
    expect(within(column('Running')).queryByText(/Decision: no Done column/)).toBeNull()
    expect(within(fields).getByRole('button', { name: 'Comments' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('switches Sessions between Kanban and a stage-labelled grid', async () => {
    const { user } = mount()
    const layout = screen.getByRole('group', { name: 'Session layout' })
    const gridButton = within(layout).getByRole('button', { name: 'Grid' })

    expect(gridButton).toHaveAttribute('data-tooltip', 'Grid layout')
    expect(gridButton).not.toHaveAttribute('title')
    expect(gridButton.querySelector('.lucide-grid-2x2')).not.toBeNull()

    fireEvent.keyDown(document, { key: 'Escape' })
    const toolbar = screen.getByRole('banner', { name: 'Agent Zen toolbar' })
    expect(toolbar).toHaveAttribute('data-tooltips-dismissed', 'true')
    fireEvent.pointerLeave(toolbar)
    expect(toolbar).toHaveAttribute('data-tooltips-dismissed', 'false')

    await user.click(gridButton)

    const grid = screen.getByRole('region', { name: 'Session grid' })
    const runningCard = within(grid).getByRole('button', { name: /Revise calm control plane/ })
    expect(grid.querySelector('[data-constrain-width]')).toHaveAttribute('data-constrain-width', 'true')
    expect(within(runningCard).getByText('Revise calm control plane')).toBeInTheDocument()
    expect(within(runningCard).getByText('Running · agent-zen')).toBeInTheDocument()
    expect(within(grid).queryByRole('button', { name: /Sweep board fixtures into tests/ })).toBeNull()
    expect(within(grid).getByText('1 subagent')).toBeInTheDocument()
    expect(within(grid).getAllByText(/Running ·/).length).toBeGreaterThan(0)
    expect(screen.queryByRole('region', { name: 'Planning' })).toBeNull()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Group sessions by' }), 'project')
    expect(within(grid).getByRole('heading', { name: 'agent-zen' })).toBeInTheDocument()

    expect(within(grid).getByText('42m total · 7m current turn')).toBeInTheDocument()
    expect(within(grid).getByText('3 / 5')).toBeInTheDocument()
  })

  it('groups the session grid by populated board lane and restores that choice after Kanban', async () => {
    const { user } = mount()
    const layout = screen.getByRole('group', { name: 'Session layout' })

    await user.click(within(layout).getByRole('button', { name: 'Grid' }))
    const groupBy = screen.getByRole('combobox', { name: 'Group sessions by' })
    await user.selectOptions(groupBy, 'state')

    const grid = screen.getByRole('region', { name: 'Session grid' })
    expect(within(grid).getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent))
      .toEqual(['Planning', 'Running', 'Needs you', 'Wrapping up'])
    expect(within(grid).queryByRole('heading', { name: 'Reviewing' })).toBeNull()
    expect(within(grid).getByText('Harbor canary review')).toBeInTheDocument()
    expect(within(grid).getByText('Reviewing · acm')).toBeInTheDocument()

    await user.click(within(layout).getByRole('button', { name: 'Kanban' }))
    expect(screen.getByRole('combobox', { name: 'Group sessions by' })).toHaveValue('none')
    await user.click(within(layout).getByRole('button', { name: 'Grid' }))
    expect(screen.getByRole('combobox', { name: 'Group sessions by' })).toHaveValue('state')
  })

  it('lets the command palette enable project grouping from Kanban when Grid stores state grouping', async () => {
    const storage = seedTestState(createMemoryStorage())
    const persisted = JSON.parse(storage.getItem(STORAGE_KEY)!)
    storage.setItem(STORAGE_KEY, JSON.stringify({
      ...persisted,
      sessionLayout: 'kanban',
      kanbanGroupBy: 'state',
    }))
    const { user } = mount(storage)

    expect(screen.getByRole('combobox', { name: 'Group sessions by' })).toHaveValue('none')
    await user.keyboard('{Meta>}k{/Meta}')
    const palette = screen.getByRole('dialog', { name: 'Command palette' })
    await user.type(within(palette).getByLabelText('Search or jump to'), 'group sessions by project')
    await user.keyboard('{Enter}')

    expect(screen.getByRole('combobox', { name: 'Group sessions by' })).toHaveValue('project')
  })
})

describe('capture', () => {
  it('captures an idea title-first and puts it at the top of the backlog', async () => {
    const { user, storage } = mount()

    await user.keyboard('c')
    const sheet = screen.getByRole('dialog', { name: 'Quick capture' })
    expect(within(sheet).getByLabelText('Title')).toHaveFocus()
    expect(within(sheet).queryByLabelText('Action')).toBeNull()
    expect(within(sheet).queryByLabelText('Repository')).toBeNull()

    await user.click(within(sheet).getByLabelText('Notes'))
    fireEvent.keyDown(window, { key: 'Meta', metaKey: true })
    expect(within(sheet).getByLabelText('Notes')).toHaveFocus()
    fireEvent.keyUp(window, { key: 'Meta' })

    await user.type(within(sheet).getByLabelText('Title'), 'Try the app-server transport')
    await user.click(within(sheet).getByRole('button', { name: 'Save' }))

    expect(screen.getByRole('status')).toHaveTextContent('Saved to Ideas')
    expect(within(column('Ideas')).getByText('Try the app-server transport')).toBeInTheDocument()
    expect(storage.getItem(STORAGE_KEY)).toContain('Try the app-server transport')
  })
})

describe('quick logbook entry', () => {
  it('appends a note from a session card without opening its detail', async () => {
    const { user, storage } = mount()
    const running = column('Running')
    const input = within(running).getByLabelText(
      'Quick logbook entry for Revise calm control plane',
    )

    await user.type(input, 'Keep the card widths as they are.{Enter}')

    expect(input).toHaveValue('')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(storage.getItem(STORAGE_KEY)).toContain('Keep the card widths as they are.')

    await user.click(within(running).getByText('Revise calm control plane'))
    const logbook = within(screen.getByRole('dialog')).getByRole('region', { name: 'Logbook' })
    expect(within(logbook).getByText('Keep the card widths as they are.')).toBeInTheDocument()
  })

  it('is available on idea cards in both the board and Ideas view', async () => {
    const { user } = mount()
    const label = 'Quick logbook entry for Session dashboard'

    const boardInput = within(column('Ideas')).getByLabelText(label)
    await user.type(boardInput, 'Compare this with the native shell.{Enter}')
    expect(boardInput).toHaveValue('')

    await user.click(screen.getByRole('tab', { name: 'Ideas' }))
    const ideasInput = screen.getByLabelText(label)
    await user.type(ideasInput, 'Keep this one local.{Enter}')

    await user.click(screen.getByText('Session dashboard'))
    const logbook = within(screen.getByRole('dialog')).getByRole('region', { name: 'Logbook' })
    expect(within(logbook).getByText('Compare this with the native shell.')).toBeInTheDocument()
    expect(within(logbook).getByText('Keep this one local.')).toBeInTheDocument()
  })
})

describe('session detail', () => {
  it('describes Planning as active native plan mode', async () => {
    const { user } = mount()

    await user.click(within(column('Planning')).getByText('Index local Codex threads'))

    expect(within(screen.getByRole('dialog')).getByText(
      'Plan mode is active; no plan has been published.',
    )).toBeInTheDocument()
  })

  it('shows the Codex plan as read-only and keeps the Logbook human-only', async () => {
    const { user } = mount()

    await user.click(within(column('Running')).getByText('Revise calm control plane'))
    const sheet = screen.getByRole('dialog')

    expect(sheet).toHaveAttribute('data-variant', 'dialog')

    expect(within(sheet).getByText('From Codex')).toBeInTheDocument()
    expect(within(sheet).getByText('read-only')).toBeInTheDocument()
    expect(within(sheet).getByText(/Plan revision 3/)).toBeInTheDocument()
    expect(within(sheet).getByText('Generate three new mockups')).toBeInTheDocument()
    const subagents = within(sheet).getByRole('region', { name: 'Subagents' })
    expect(subagents).toHaveTextContent('Sweep board fixtures into tests')
    expect(within(sheet).queryByText('Agent Zen stage')).toBeNull()

    await user.click(
      within(subagents).getByRole('button', { name: /Sweep board fixtures into tests/ }),
    )
    expect(
      within(sheet).getByRole('heading', { name: 'Sweep board fixtures into tests' }),
    ).toBeInTheDocument()
    expect(
      within(sheet).getByRole('button', { name: 'Revise calm control plane' }),
    ).toBeInTheDocument()

    const logbook = within(sheet).getByRole('region', { name: 'Logbook' })
    expect(within(logbook).getByText('Yours. Agents never write here.')).toBeInTheDocument()
  })

  it('resets session-local detail state when navigating between parent and subagent', async () => {
    const { user } = mount()

    await user.click(within(column('Running')).getByText('Revise calm control plane'))
    const sheet = screen.getByRole('dialog')
    const history = within(sheet).getByRole('button', { name: /earlier plan revisions/ })
    await user.click(history)
    expect(history).toHaveAttribute('aria-expanded', 'true')

    await user.click(
      within(sheet).getByRole('button', { name: /Sweep board fixtures into tests/ }),
    )
    await user.click(within(sheet).getByRole('button', { name: 'Revise calm control plane' }))

    expect(within(sheet).getByRole('button', { name: /earlier plan revisions/ }))
      .toHaveAttribute('aria-expanded', 'false')
  })

  it('appends a human note to the Logbook', async () => {
    const { user, storage } = mount()

    await user.click(within(column('Running')).getByText('Revise calm control plane'))
    const logbook = within(screen.getByRole('dialog')).getByRole('region', { name: 'Logbook' })
    const before = within(logbook).getAllByRole('listitem').length

    await user.type(within(logbook).getByLabelText('New logbook note'), 'Column widths feel right.')
    await user.click(within(logbook).getByRole('button', { name: 'Add note' }))

    expect(within(logbook).getAllByRole('listitem')).toHaveLength(before + 1)
    expect(within(logbook).getByText('Column widths feel right.')).toBeInTheDocument()
    expect(storage.getItem(STORAGE_KEY)).toContain('"author":"human"')
  })

  it('answers a native request and keeps interrupt available while Codex waits', async () => {
    const base = createFixtureSessionSource({ now: NOW, tickMs: 0 }).snapshot()
    const owned = {
      ...base.find((session) => session.title === 'Revise calm control plane')!,
      source: 'owned' as const,
      activity: 'awaiting-input' as const,
      pendingRequest: {
        kind: 'user-input' as const,
        requestId: 41,
        questions: [{
          id: 'scope',
          header: 'Scope',
          question: 'Where should this apply?',
          isOther: false,
          isSecret: false,
          options: [{ label: 'Current session', description: 'Only this session.' }],
        }],
      },
      classification: { stage: 'running', reason: 'active-turn', needsUser: true } as const,
    }
    const responses: unknown[] = []
    const snapshot: BridgeSnapshot = {
      ...disconnectedSnapshot,
      connection: { connected: true, label: 'Live Codex', userAgent: 'test', error: null },
      backends: [],
      sessions: [owned],
      preferences: selectUiPreferences(createInitialState(NOW)),
      projects: SEED_PROJECTS,
    }
    const bridge: AgentZenBridge = {
      ...disconnectedBridge(),
      snapshot: () => snapshot,
      subscribe: (listener) => {
        listener(snapshot)
        return () => undefined
      },
      refresh: async () => snapshot,
      respond: async (_threadId, response) => { responses.push(response) },
    }
    const user = userEvent.setup({ document })
    render(
      <AgentZenProvider bridge={bridge} now={NOW} storage={createMemoryStorage()}>
        <App />
      </AgentZenProvider>,
    )

    await user.click(screen.getByText('Revise calm control plane'))
    const sheet = screen.getByRole('dialog')
    expect(within(sheet).getByRole('button', { name: 'Interrupt' })).toBeInTheDocument()
    await user.selectOptions(within(sheet).getByLabelText('Scope'), 'Current session')
    await user.click(within(sheet).getByRole('button', { name: 'Send answer' }))

    await waitFor(() => expect(responses).toEqual([{
      requestId: 41,
      kind: 'user-input',
      answers: { scope: ['Current session'] },
    }]))
  })

  it('renders the canonical daemon classification instead of reclassifying the session in the UI', () => {
    const base = createFixtureSessionSource({ now: NOW, tickMs: 0 }).snapshot()
    const running = base.find((session) => session.title === 'Revise calm control plane')!
    const snapshot: BridgeSnapshot = {
      ...disconnectedSnapshot,
      connection: { connected: true, label: 'Live Codex', userAgent: 'test', error: null },
      backends: [],
      sessions: [{
        ...running,
        classification: {
          stage: 'wrapping-up',
          reason: 'explicit-wrapup-invocation',
          needsUser: false,
        },
      }],
      preferences: selectUiPreferences(createInitialState(NOW)),
      projects: SEED_PROJECTS,
    }
    const bridge: AgentZenBridge = {
      ...disconnectedBridge(),
      snapshot: () => snapshot,
      subscribe: (listener) => {
        listener(snapshot)
        return () => undefined
      },
      refresh: async () => snapshot,
    }

    render(
      <AgentZenProvider bridge={bridge} now={NOW} storage={createMemoryStorage()}>
        <App />
      </AgentZenProvider>,
    )

    expect(within(column('Wrapping up')).getByText('Revise calm control plane')).toBeInTheDocument()
    expect(within(column('Running')).queryByText('Revise calm control plane')).toBeNull()
  })
})

describe('settings and limits', () => {
  it('shows an agent-neutral empty state and connected backend warnings', async () => {
    const snapshot: BridgeSnapshot = {
      ...disconnectedSnapshot,
      connection: { connected: true, label: 'Claude Code · local observer', userAgent: 'Claude Code 2.1.259', error: null },
      backends: [{
        agent: 'claude',
        connected: true,
        label: 'Claude Code · local observer',
        userAgent: 'Claude Code 2.1.259',
        error: '1 Claude Code session could not be read.',
      }],
      preferences: selectUiPreferences(createInitialState(NOW)),
    }
    const bridge: AgentZenBridge = {
      ...disconnectedBridge(),
      snapshot: () => snapshot,
      subscribe: (listener) => {
        listener(snapshot)
        return () => undefined
      },
      refresh: async () => snapshot,
    }
    const user = userEvent.setup({ document })
    render(
      <AgentZenProvider bridge={bridge} now={NOW} storage={createMemoryStorage()}>
        <App />
      </AgentZenProvider>,
    )

    await user.keyboard('{Meta>},{/Meta}')
    const settings = screen.getByRole('dialog', { name: 'Settings' })
    expect(within(settings).getByText('Start an agent session in a repository or add one manually.')).toBeInTheDocument()
    expect(within(settings).getByText(/Claude Code 2\.1\.259 · 1 Claude Code session could not be read/)).toBeInTheDocument()
  })

  it('keeps hidden agents in the visible focus count', async () => {
    const base = createFixtureSessionSource({ now: NOW, tickMs: 0 }).snapshot()
    const running = base.find((session) => session.title === 'Revise calm control plane')!
    const snapshot: BridgeSnapshot = {
      ...disconnectedSnapshot,
      connection: { connected: true, label: 'Live agents', userAgent: 'test', error: null },
      sessions: [
        { ...running, id: 'codex-visible', threadId: 'codex-visible', agent: 'codex', classification: { stage: 'running', reason: 'active-turn', needsUser: false } },
        { ...running, id: 'claude-hidden', threadId: 'claude-hidden', title: 'Hidden Claude work', agent: 'claude', classification: { stage: 'running', reason: 'active-turn', needsUser: false } },
      ],
      focus: {
        enabled: true,
        limit: 3,
        activeCount: 2,
        availability: { allowed: true, reason: 'slot-available' },
      },
      preferences: {
        ...selectUiPreferences(createInitialState(NOW)),
        visibleAgents: ['codex'],
      },
      projects: SEED_PROJECTS,
    }
    const bridge: AgentZenBridge = {
      ...disconnectedBridge(),
      snapshot: () => snapshot,
      subscribe: (listener) => {
        listener(snapshot)
        return () => undefined
      },
      refresh: async () => snapshot,
    }
    render(
      <AgentZenProvider bridge={bridge} now={NOW} storage={createMemoryStorage()}>
        <App />
      </AgentZenProvider>,
    )

    await waitFor(() => expect(screen.getByRole('button', { name: /Active 2 \/ 3/ })).toBeInTheDocument())
    expect(screen.queryByText('Hidden Claude work')).toBeNull()
  })

  it('flags a hidden agent that needs you and never hides the last visible agent', async () => {
    const base = createFixtureSessionSource({ now: NOW, tickMs: 0 }).snapshot()
    const running = base.find((session) => session.title === 'Revise calm control plane')!
    let snapshot: BridgeSnapshot = {
      ...disconnectedSnapshot,
      connection: { connected: true, label: 'Live agents', userAgent: 'test', error: null },
      sessions: [
        { ...running, id: 'codex-visible', threadId: 'codex-visible', title: 'Visible Codex work', agent: 'codex', classification: { stage: 'running', reason: 'active-turn', needsUser: false } },
        { ...running, id: 'claude-waiting', threadId: 'claude-waiting', title: 'Waiting Claude work', agent: 'claude', activity: 'awaiting-input', classification: { stage: 'running', reason: 'active-turn', needsUser: true } },
      ],
      preferences: { ...selectUiPreferences(createInitialState(NOW)), visibleAgents: ['codex'] },
      projects: SEED_PROJECTS,
    }
    const bridge: AgentZenBridge = {
      ...disconnectedBridge(),
      snapshot: () => snapshot,
      subscribe: (listener) => {
        listener(snapshot)
        return () => undefined
      },
      refresh: async () => snapshot,
      setPreferences: async (next) => {
        snapshot = { ...snapshot, preferences: next }
        return snapshot
      },
    }
    const user = userEvent.setup({ document })
    render(
      <AgentZenProvider bridge={bridge} now={NOW} storage={createMemoryStorage()}>
        <App />
      </AgentZenProvider>,
    )

    const agents = await screen.findByRole('group', { name: 'Agents' })
    const codex = within(agents).getByRole('button', { name: 'Codex sessions, at least one agent stays visible' })
    expect(codex).toHaveAttribute('aria-disabled', 'true')
    await user.click(codex)
    expect(screen.getByText('Visible Codex work')).toBeInTheDocument()

    await user.keyboard('{Meta>}k{/Meta}')
    const palette = screen.getByRole('dialog', { name: 'Command palette' })
    expect(within(palette).queryByText('Hide Codex sessions')).toBeNull()
    expect(within(palette).getByText('Show Claude Code sessions')).toBeInTheDocument()
    await user.keyboard('{Escape}')

    const claude = within(agents).getByRole('button', { name: 'Claude Code sessions, hidden, 1 needs you' })
    expect(screen.queryByText('Waiting Claude work')).toBeNull()
    await user.click(claude)
    expect(await screen.findByText('Waiting Claude work')).toBeInTheDocument()
    expect(within(agents).getByRole('button', { name: 'Claude Code sessions' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('releases global shortcuts when the open session leaves the board', async () => {
    const base = createFixtureSessionSource({ now: NOW, tickMs: 0 }).snapshot()
    const running = base.find((session) => session.title === 'Revise calm control plane')!
    const listeners = new Set<(snapshot: BridgeSnapshot) => void>()
    let snapshot: BridgeSnapshot = {
      ...disconnectedSnapshot,
      connection: { connected: true, label: 'Live agents', userAgent: 'test', error: null },
      sessions: [
        { ...running, id: 'claude-open', threadId: 'claude-open', title: 'Claude work in view', agent: 'claude', classification: { stage: 'running', reason: 'active-turn', needsUser: false } },
      ],
      projects: SEED_PROJECTS,
    }
    const bridge: AgentZenBridge = {
      ...disconnectedBridge(),
      snapshot: () => snapshot,
      subscribe: (listener) => {
        listeners.add(listener)
        listener(snapshot)
        return () => listeners.delete(listener)
      },
      refresh: async () => snapshot,
    }
    const user = userEvent.setup({ document })
    render(
      <AgentZenProvider bridge={bridge} now={NOW} storage={createMemoryStorage()}>
        <App />
      </AgentZenProvider>,
    )

    await user.click(await screen.findByText('Claude work in view'))
    expect(screen.getByTestId('detail-sheet')).toBeInTheDocument()

    snapshot = { ...snapshot, sessions: [], generatedAt: new Date().toISOString() }
    act(() => {
      for (const listener of listeners) listener(snapshot)
    })
    await waitFor(() => expect(screen.queryByTestId('detail-sheet')).toBeNull())

    await user.keyboard('{Meta>}k{/Meta}')
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeInTheDocument()
  })

  it('enables the focus limit and uses it to refuse a new root launch', async () => {
    const { user } = mount()

    await user.keyboard('{Meta>},{/Meta}')
    const settings = screen.getByRole('dialog', { name: 'Settings' })
    await user.click(within(settings).getByRole('switch', { name: 'Enable focus limit' }))
    await user.click(within(settings).getByRole('button', { name: 'Lower active session limit' }))
    await user.click(within(settings).getByRole('button', { name: 'Close settings' }))

    expect(screen.getByRole('button', { name: /Active 3 \/ 2/ })).toBeInTheDocument()
    await user.click(within(column('Ideas')).getByText('Session dashboard'))

    const detail = screen.getByRole('dialog')
    expect(within(detail).getByRole('button', { name: 'Launch session' })).toBeDisabled()
    expect(within(detail).getByText(/Focus limit reached: 3 of 2/)).toBeInTheDocument()
  })

  it('disables launch when Claude is connected but the Codex controller is unavailable', async () => {
    const snapshot: BridgeSnapshot = {
      ...disconnectedSnapshot,
      connection: { connected: true, label: 'Claude Code · local observer', userAgent: 'Claude Code', error: null },
      backends: [
        { agent: 'codex', connected: false, label: 'Codex unavailable', userAgent: null, error: 'offline' },
        { agent: 'claude', connected: true, label: 'Claude Code · local observer', userAgent: 'Claude Code', error: null },
      ],
      preferences: selectUiPreferences(createInitialState(NOW)),
      projects: SEED_PROJECTS,
    }
    const bridge: AgentZenBridge = {
      ...disconnectedBridge(),
      snapshot: () => snapshot,
      subscribe: (listener) => {
        listener(snapshot)
        return () => undefined
      },
      refresh: async () => snapshot,
    }
    const user = userEvent.setup({ document })
    render(
      <AgentZenProvider bridge={bridge} now={NOW} storage={seedTestState(createMemoryStorage())}>
        <App />
      </AgentZenProvider>,
    )

    await user.click(within(column('Ideas')).getByText('Session dashboard'))

    const detail = screen.getByRole('dialog')
    expect(within(detail).getByRole('button', { name: 'Launch session' })).toBeDisabled()
    expect(within(detail).getByText('Codex is unavailable, so Agent Zen cannot launch a session.')).toBeInTheDocument()
  })

  it('disables launch when aggregate connectivity is down despite a stale Codex status', async () => {
    const snapshot: BridgeSnapshot = {
      ...disconnectedSnapshot,
      backends: [
        { agent: 'codex', connected: true, label: 'Codex App Server', userAgent: 'Codex', error: null },
      ],
      preferences: selectUiPreferences(createInitialState(NOW)),
      projects: SEED_PROJECTS,
    }
    const bridge: AgentZenBridge = {
      ...disconnectedBridge(),
      snapshot: () => snapshot,
      subscribe: (listener) => {
        listener(snapshot)
        return () => undefined
      },
      refresh: async () => snapshot,
    }
    const user = userEvent.setup({ document })
    render(
      <AgentZenProvider bridge={bridge} now={NOW} storage={seedTestState(createMemoryStorage())}>
        <App />
      </AgentZenProvider>,
    )

    await user.click(within(column('Ideas')).getByText('Session dashboard'))

    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Launch session' })).toBeDisabled()
  })

  it('registers a discovered local project through the quiet onboarding flow', async () => {
    const { user, storage } = mount()

    await user.keyboard('{Meta>},{/Meta}')
    await user.click(screen.getByRole('button', { name: 'Add projects…' }))
    const onboarding = screen.getByRole('dialog', {
      name: 'Add another repository',
    })
    await user.click(within(onboarding).getByText('lucharo/taskflow'))
    await user.click(within(onboarding).getByRole('button', { name: 'Register 1 project' }))

    const settings = screen.getByRole('dialog', { name: 'Settings' })
    expect(within(settings).getByText('taskflow')).toBeInTheDocument()
    expect(storage.getItem(STORAGE_KEY)).toContain('lucharo/taskflow')
  })
})

describe('cold reload', () => {
  it('restores locally owned state and leaves agent state to the source', async () => {
    const storage = createMemoryStorage()
    const first = mount(storage)

    await first.user.keyboard('c')
    const sheet = screen.getByRole('dialog', { name: 'Quick capture' })
    await first.user.type(within(sheet).getByLabelText('Title'), 'Survive the reload')
    await first.user.click(within(sheet).getByRole('button', { name: 'Save' }))
    await first.user.click(
      within(screen.getByRole('tablist', { name: 'View' })).getByText('Ideas'),
    )

    first.unmount()
    mount(storage)

    // The captured idea and the chosen view both came back from localStorage;
    // the sessions came back from the source, not from disk.
    expect(screen.getByText('Survive the reload')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Running' })).toBeNull()
  })
})
