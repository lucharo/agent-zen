import type {
  IdeaGroupBy,
  IdeaLayout,
  KanbanCardDetail,
  KanbanGroupBy,
  ThemeChoice,
  View,
} from '@/domain/types'
import { captureShortcutLabel } from '@/keyboard'
import { useAgentZen } from '@/state/store'
import { GridIcon, ListIcon, SearchIcon, Select } from './primitives'
import styles from './Toolbar.module.css'

const THEME_ORDER: readonly ThemeChoice[] = ['system', 'light', 'dark']

export interface ToolbarProps {
  ideaCount: number
  onOpenPalette: () => void
  onOpenCapture: () => void
  onOpenSettings: () => void
  showShortcuts: boolean
}

/**
 * One row, always. Everything that is not Kanban or Ideas is a filter or a
 * quick field here — never a third destination.
 */
export function Toolbar({
  ideaCount,
  onOpenPalette,
  onOpenCapture,
  onOpenSettings,
  showShortcuts,
}: ToolbarProps) {
  const { state, dispatch, activeCount, availableProjects } = useAgentZen()
  const onIdeas = state.view === 'ideas'

  const setView = (view: View) => dispatch({ type: 'set-view', view })

  return (
    <header
      className={styles.toolbar}
      data-shortcuts={showShortcuts}
      aria-label="Agent Zen toolbar"
    >
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
            <kbd className={styles.contextShortcut}>{view === 'kanban' ? '⌘1' : '⌘2'}</kbd>
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
          ...availableProjects.map((p) => ({ value: p.id, label: p.name })),
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
      ) : (
        <>
          <Select
            label="Group sessions by"
            prefix="Group by:"
            value={state.kanbanGroupBy}
            onChange={(value) =>
              dispatch({ type: 'set-kanban-group-by', groupBy: value as KanbanGroupBy })
            }
            options={[
              { value: 'none', label: 'None' },
              { value: 'project', label: 'Project' },
            ]}
          />
          <Select
            label="Session card detail"
            prefix="Cards:"
            value={state.kanbanCardDetail}
            onChange={(value) =>
              dispatch({ type: 'set-kanban-card-detail', detail: value as KanbanCardDetail })
            }
            options={[
              { value: 'details', label: 'Details' },
              { value: 'titles', label: 'Titles' },
            ]}
          />
        </>
      )}

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
        <button
          type="button"
          className={styles.limitButton}
          data-enabled={state.activeLimitEnabled}
          data-at-limit={state.activeLimitEnabled && activeCount >= state.activeLimit}
          onClick={onOpenSettings}
          title="Open focus-limit settings. Child agents share a parent slot; review and wrapup release capacity."
        >
          <span>{state.activeLimitEnabled ? 'Active' : 'Limit'}</span>
          <strong>
            {state.activeLimitEnabled ? `${activeCount} / ${state.activeLimit}` : 'off'}
          </strong>
          <kbd className={styles.contextShortcut}>⌘,</kbd>
        </button>
      )}

      <button
        type="button"
        className={styles.themeButton}
        onClick={() => dispatch({ type: 'set-theme', theme: nextTheme(state.theme) })}
        aria-label={`Theme: ${themeLabel(state.theme)}. Click to use ${themeLabel(nextTheme(state.theme))}.`}
        title={`Theme: ${themeLabel(state.theme)}`}
      >
        <ThemeIcon theme={state.theme} />
        <span>{themeLabel(state.theme)}</span>
      </button>

      <button
        type="button"
        className={styles.add}
        onClick={onOpenCapture}
        aria-label={`Quick capture (${captureShortcutLabel()})`}
        title={`Quick capture · ${captureShortcutLabel()}`}
      >
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <path
            d="M8 3.2v9.6M3.2 8h9.6"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
        <kbd className={styles.addShortcut}>{captureShortcutLabel()}</kbd>
      </button>
    </header>
  )
}

function nextTheme(theme: ThemeChoice): ThemeChoice {
  const index = THEME_ORDER.indexOf(theme)
  return THEME_ORDER[(index + 1) % THEME_ORDER.length] ?? 'system'
}

function themeLabel(theme: ThemeChoice): string {
  return theme[0]!.toUpperCase() + theme.slice(1)
}

function ThemeIcon({ theme }: { theme: ThemeChoice }) {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      {theme === 'system' ? (
        <>
          <rect x="2.2" y="3" width="11.6" height="8" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.25" />
          <path d="M6 13h4M8 11v2" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
        </>
      ) : (
        <>
          <circle cx="8" cy="8" r="2.5" fill={theme === 'light' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.2" />
          <path d="M8 1.6v1.5M8 12.9v1.5M1.6 8h1.5M12.9 8h1.5M3.5 3.5l1.1 1.1M11.4 11.4l1.1 1.1M12.5 3.5l-1.1 1.1M4.6 11.4l-1.1 1.1" stroke="currentColor" strokeWidth="1.15" strokeLinecap="round" />
        </>
      )}
    </svg>
  )
}
