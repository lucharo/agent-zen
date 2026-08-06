import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from '@/App'
import { createFixtureSessionSource } from '@/adapters/fixtureSource'
import { STORAGE_KEY } from '@/state/persistence'
import { AgentZenProvider } from '@/state/store'
import { createMemoryStorage } from '@/test/memoryStorage'

const NOW = new Date('2026-08-06T11:00:00Z').getTime()

/** A frozen clock and a non-ticking source, so nothing moves mid-assertion. */
function mount(storage: Storage = createMemoryStorage()) {
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

const column = (name: string) => screen.getByRole('region', { name })

describe('the board', () => {
  it('shows five columns and marks only the agent-backed ones as Codex', () => {
    mount()

    for (const name of ['Ideas', 'Planning', 'Running', 'Reviewing', 'Wrapping up']) {
      expect(column(name)).toBeInTheDocument()
    }

    // The mark lives in the column title, never on a card.
    expect(within(column('Running')).getByText('Codex')).toBeInTheDocument()
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
    expect(within(column('Ideas')).getByText(/ideas hidden/)).toBeInTheDocument()
    expect(within(column('Ideas')).getByRole('button', { name: 'Ideas', expanded: false })).toHaveAttribute(
      'title',
      'Expand Ideas',
    )
  })

  it('routes to quiet history rather than a Done column', async () => {
    const { user } = mount()
    expect(screen.queryByRole('region', { name: 'Done' })).toBeNull()

    await user.click(screen.getByRole('button', { name: /finished session/ }))

    expect(screen.getByRole('dialog')).toHaveTextContent('History')
  })
})

describe('navigation', () => {
  it('switches between the two primary views', async () => {
    const { user } = mount()
    const tabs = screen.getByRole('tablist', { name: 'View' })

    await user.click(within(tabs).getByText('Ideas'))

    expect(screen.queryByRole('region', { name: 'Running' })).toBeNull()
    expect(within(tabs).getByText('Ideas')).toHaveAttribute('aria-selected', 'true')
  })

  it('opens the command palette on cmd+k and runs a command', async () => {
    const { user } = mount()

    await user.keyboard('{Meta>}k{/Meta}')
    const palette = screen.getByRole('dialog', { name: 'Command palette' })
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
})

describe('capture', () => {
  it('captures an idea title-first and puts it at the top of the backlog', async () => {
    const { user, storage } = mount()

    await user.keyboard('{Meta>}n{/Meta}')
    const sheet = screen.getByRole('dialog', { name: 'Quick capture' })
    expect(within(sheet).getByLabelText('Title')).toHaveFocus()

    await user.type(within(sheet).getByLabelText('Title'), 'Try the app-server transport')
    await user.click(within(sheet).getByRole('button', { name: 'Save' }))

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
      name: 'Choose the repositories you work in',
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

    await first.user.keyboard('{Meta>}n{/Meta}')
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
