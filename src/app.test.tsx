import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from '@/App'
import { createFixtureSessionSource } from '@/adapters/fixtureSource'
import type { AgentZenBridge } from '@/bridge/httpBridge'
import type { BridgeSnapshot } from '@/bridge/types'
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
  protocolVersion: 2,
  generatedAt: new Date().toISOString(),
  connection: { connected: false, label: 'Unavailable', userAgent: null, error: 'offline' },
  sessions: [],
  focus: {
    enabled: false,
    limit: 3,
    activeCount: 0,
    availability: { allowed: true, reason: 'limit-disabled' },
  },
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
    registerProjects: async () => disconnectedSnapshot,
    launch: async () => {
      throw new Error('offline')
    },
    interrupt: async () => undefined,
    steer: async () => undefined,
  }
}

function pendingBridge(): AgentZenBridge {
  return {
    ...disconnectedBridge(),
    subscribe: () => () => undefined,
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

    expect(screen.getByRole('status')).toHaveTextContent('Connecting to Codex')
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
  })

  it('shows five columns and marks only the agent-backed ones as Codex', () => {
    mount()

    for (const name of ['Ideas', 'Planning', 'Running', 'Reviewing', 'Wrapping up']) {
      expect(column(name)).toBeInTheDocument()
    }

    // The mark lives in the column title, never on a card.
    const runningHeader = column('Running').querySelector('header')
    expect(runningHeader).not.toBeNull()
    expect(within(runningHeader as HTMLElement).getByText('Codex')).toBeInTheDocument()
    expect(within(column('Ideas')).queryByText('Codex')).toBeNull()
  })

  it('places each fixture session in the column its own state implies', () => {
    mount()

    expect(within(column('Planning')).getByText('Index local Codex threads')).toBeInTheDocument()
    expect(within(column('Running')).getByText('Revise calm control plane')).toBeInTheDocument()
    expect(
      within(column('Running')).getByText(/Generate three new mockups/),
    ).toBeInTheDocument()
    expect(within(column('Running')).getByText('42m total · 7m current turn')).toBeInTheDocument()
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

  it('does not invent a history count from the observer window', () => {
    mount()
    expect(screen.queryByRole('region', { name: 'Done' })).toBeNull()
    expect(screen.queryByText(/finished sessions? in history/)).toBeNull()
  })
})

describe('navigation', () => {
  it('reveals contextual shortcut hints while Command is held', () => {
    mount()

    fireEvent.keyDown(window, { key: 'Meta', metaKey: true })
    expect(screen.getByRole('banner', { name: 'Agent Zen toolbar' })).toHaveAttribute('data-shortcuts', 'true')
    fireEvent.keyUp(window, { key: 'Meta' })
    expect(screen.getByRole('banner', { name: 'Agent Zen toolbar' })).toHaveAttribute('data-shortcuts', 'false')
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

    expect(within(column('Reviewing')).getByText('Harbor canary review')).toBeInTheDocument()
    expect(within(column('Running')).getByText('Nothing in flight')).toBeInTheDocument()
  })

  it('toggles the backlog between grid and list', async () => {
    const { user } = mount()
    await user.click(within(screen.getByRole('tablist', { name: 'View' })).getByText('Ideas'))

    const layout = screen.getByRole('group', { name: 'Layout' })
    expect(screen.getAllByRole('list')[0]).toHaveAttribute('data-layout', 'grid')

    await user.click(within(layout).getByRole('button', { name: 'List' }))

    expect(screen.getAllByRole('list')[0]).toHaveAttribute('data-layout', 'list')
  })

  it('groups sessions by project and switches cards to title-only', async () => {
    const { user } = mount()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Group sessions by' }), 'project')
    expect(within(column('Running')).getByText('agent-zen')).toBeInTheDocument()

    expect(screen.queryByRole('combobox', { name: 'Session card detail' })).toBeNull()
    await user.click(within(screen.getByRole('group', { name: 'Card detail' })).getByRole('button', {
      name: 'Titles only',
    }))
    expect(within(column('Running')).queryByText('42m total · 7m current turn')).toBeNull()
    expect(within(column('Running')).getByText('Revise calm control plane')).toBeInTheDocument()
  })

  it('switches Sessions between Kanban and a stage-labelled grid', async () => {
    const { user } = mount()

    await user.click(within(screen.getByRole('group', { name: 'Session layout' })).getByRole('button', {
      name: 'Grid',
    }))

    const grid = screen.getByRole('region', { name: 'Session grid' })
    expect(within(grid).getByText('Revise calm control plane')).toBeInTheDocument()
    expect(within(grid).getAllByText('Running').length).toBeGreaterThan(0)
    expect(screen.queryByRole('region', { name: 'Planning' })).toBeNull()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Group sessions by' }), 'project')
    expect(within(grid).getByRole('heading', { name: 'agent-zen' })).toBeInTheDocument()

    await user.click(within(screen.getByRole('group', { name: 'Card detail' })).getByRole('button', {
      name: 'Titles only',
    }))
    expect(within(grid).queryByText('42m total · 7m current turn')).toBeNull()
  })
})

describe('capture', () => {
  it('captures an idea title-first and puts it at the top of the backlog', async () => {
    const { user, storage } = mount()

    await user.keyboard('c')
    const sheet = screen.getByRole('dialog', { name: 'Quick capture' })
    expect(within(sheet).getByLabelText('Title')).toHaveFocus()

    await user.type(within(sheet).getByLabelText('Title'), 'Try the app-server transport')
    await user.click(within(sheet).getByRole('button', { name: 'Save' }))

    expect(screen.getByRole('status')).toHaveTextContent('Saved to Ideas')
    expect(within(column('Ideas')).getByText('Try the app-server transport')).toBeInTheDocument()
    expect(storage.getItem(STORAGE_KEY)).toContain('Try the app-server transport')
  })
})

describe('session detail', () => {
  it('shows the Codex plan as read-only and keeps the Logbook human-only', async () => {
    const { user } = mount()

    await user.click(within(column('Running')).getByText('Revise calm control plane'))
    const sheet = screen.getByRole('dialog')

    expect(sheet).toHaveAttribute('data-variant', 'dialog')

    expect(within(sheet).getByText('From Codex')).toBeInTheDocument()
    expect(within(sheet).getByText('read-only')).toBeInTheDocument()
    expect(within(sheet).getByText(/Plan revision 3/)).toBeInTheDocument()
    expect(within(sheet).getByText('Generate three new mockups')).toBeInTheDocument()
    expect(within(sheet).queryByText('Agent Zen stage')).toBeNull()

    const logbook = within(sheet).getByRole('region', { name: 'Logbook' })
    expect(within(logbook).getByText('Yours. Agents never write here.')).toBeInTheDocument()
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
})

describe('settings and limits', () => {
  it('enables the focus limit and uses it to refuse a new root launch', async () => {
    const { user } = mount()

    await user.keyboard('{Meta>},{/Meta}')
    const settings = screen.getByRole('dialog', { name: 'Settings' })
    await user.click(within(settings).getByRole('switch'))
    await user.click(within(settings).getByRole('button', { name: 'Lower active session limit' }))
    await user.click(within(settings).getByRole('button', { name: 'Close settings' }))

    expect(screen.getByRole('button', { name: /Active 2 \/ 2/ })).toBeInTheDocument()
    await user.click(within(column('Ideas')).getByText('Session dashboard'))

    const detail = screen.getByRole('dialog')
    expect(within(detail).getByRole('button', { name: 'Launch session' })).toBeDisabled()
    expect(within(detail).getByText(/Focus limit reached: 2 of 2/)).toBeInTheDocument()
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
