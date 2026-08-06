import type { IdeaGroupBy, IdeaLayout, ThemeChoice, View } from '@/domain/types'
import { useAgentZen } from '@/state/store'
import { GridIcon, ListIcon, SearchIcon, Select } from './primitives'
import styles from './Toolbar.module.css'

const THEMES: ReadonlyArray<{ value: ThemeChoice; label: string }> = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

export interface ToolbarProps {
  ideaCount: number
  onOpenPalette: () => void
  onOpenCapture: () => void
}

/**
 * One row, always. Everything that is not Kanban or Ideas is a filter or a
 * quick field here — never a third destination.
 */
export function Toolbar({ ideaCount, onOpenPalette, onOpenCapture }: ToolbarProps) {
  const { state, dispatch, activeCount } = useAgentZen()
  const onIdeas = state.view === 'ideas'

  const setView = (view: View) => dispatch({ type: 'set-view', view })

  return (
    <header className={styles.toolbar}>
      <div className={styles.viewSwitch} role="tablist" aria-label="View">
        {(['kanban', 'ideas'] as const).map((view) => (
          <button
            key={view}
            role="tab"
            type="button"
            aria-selected={state.view === view}
            className={styles.viewTab}
            data-selected={state.view === view}
            onClick={() => setView(view)}
          >
            {view === 'kanban' ? 'Kanban' : 'Ideas'}
          </button>
        ))}
      </div>

      <Select
        label="Filter by project"
        value={state.projectFilter ?? 'all'}
        onChange={(value) =>
          dispatch({ type: 'set-project-filter', projectId: value === 'all' ? null : value })
        }
        options={[
          { value: 'all', label: 'All projects' },
          ...state.projects.map((p) => ({ value: p.id, label: p.name })),
        ]}
      />

      {onIdeas ? (
        <>
          <Select
            label="Group ideas by"
            prefix="Group by:"
            value={state.ideaGroupBy}
            onChange={(value) =>
              dispatch({ type: 'set-idea-group-by', groupBy: value as IdeaGroupBy })
            }
            options={[
              { value: 'created', label: 'Creation date' },
              { value: 'project', label: 'Project' },
            ]}
          />
          <div className={styles.segmented} role="group" aria-label="Layout">
            {(['grid', 'list'] as const).map((layout) => (
              <button
                key={layout}
                type="button"
                className={styles.segment}
                data-selected={state.ideaLayout === layout}
                aria-pressed={state.ideaLayout === layout}
                aria-label={layout === 'grid' ? 'Grid' : 'List'}
                onClick={() => dispatch({ type: 'set-idea-layout', layout: layout as IdeaLayout })}
              >
                {layout === 'grid' ? <GridIcon /> : <ListIcon />}
              </button>
            ))}
          </div>
        </>
      ) : null}

      <button type="button" className={styles.search} onClick={onOpenPalette}>
        <SearchIcon />
        <span className={styles.searchLabel}>Search or jump…</span>
        <kbd className={styles.kbd}>⌘K</kbd>
      </button>

      {onIdeas ? (
        <p className={styles.count}>
          {ideaCount} {ideaCount === 1 ? 'idea' : 'ideas'}
        </p>
      ) : (
        <ActiveStepper active={activeCount} limit={state.activeLimit} />
      )}

      <div className={styles.segmented} role="group" aria-label="Theme">
        {THEMES.map((theme) => (
          <button
            key={theme.value}
            type="button"
            className={styles.segment}
            data-selected={state.theme === theme.value}
            aria-pressed={state.theme === theme.value}
            onClick={() => dispatch({ type: 'set-theme', theme: theme.value })}
          >
            {theme.label}
          </button>
        ))}
      </div>

      <button type="button" className={styles.add} onClick={onOpenCapture} aria-label="Quick capture">
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <path
            d="M8 3.2v9.6M3.2 8h9.6"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </header>
  )
}

/**
 * `Active 2 / 3` is precise, not decorative: root sessions in Planning or
 * Running. Child agents share their parent's slot and review/wrapup are waiting
 * on a human, so a five-card board can honestly read 2.
 */
function ActiveStepper({ active, limit }: { active: number; limit: number }) {
  const { dispatch } = useAgentZen()
  return (
    <div
      className={styles.stepper}
      title="Root sessions in Planning or Running. Child agents share their parent's slot."
    >
      <span className={styles.stepperLabel}>Active</span>
      <span className={styles.stepperValue} data-at-limit={active >= limit}>
        {active} / {limit}
      </span>
      <span className={styles.stepperButtons}>
        <button
          type="button"
          aria-label="Raise the active session limit"
          onClick={() => dispatch({ type: 'set-active-limit', limit: limit + 1 })}
        >
          <svg viewBox="0 0 10 6" width="10" height="6" aria-hidden="true">
            <path
              d="M1.4 4.4 5 1.2l3.6 3.2"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <button
          type="button"
          aria-label="Lower the active session limit"
          onClick={() => dispatch({ type: 'set-active-limit', limit: limit - 1 })}
        >
          <svg viewBox="0 0 10 6" width="10" height="6" aria-hidden="true">
            <path
              d="M1.4 1.6 5 4.8l3.6-3.2"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </span>
    </div>
  )
}
