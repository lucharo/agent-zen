import { useEffect, useState } from 'react'
import type {
  IdeaGroupBy,
  IdeaLayout,
  KanbanCardDetail,
  KanbanGroupBy,
  SessionLayout,
  ThemeChoice,
  View,
} from '@/domain/types'
import { Monitor, Moon, Plus, Sun } from 'lucide-react'
import { captureShortcutLabel } from '@/keyboard'
import { useAgentZen } from '@/state/store'
import {
  BoardIcon,
  DetailsIcon,
  GridIcon,
  ListIcon,
  SearchIcon,
  Select,
  TitleIcon,
} from './primitives'
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
 * One row, always. Everything that is not Sessions or Ideas is a filter or a
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
  const [tooltipsDismissed, setTooltipsDismissed] = useState(false)
  const onIdeas = state.view === 'ideas'

  const setView = (view: View) => dispatch({ type: 'set-view', view })

  useEffect(() => {
    const dismissTooltips = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setTooltipsDismissed(true)
    }
    document.addEventListener('keydown', dismissTooltips)
    return () => document.removeEventListener('keydown', dismissTooltips)
  }, [])

  return (
    <header
      className={styles.toolbar}
      data-shortcuts={showShortcuts}
      data-tooltips-dismissed={tooltipsDismissed}
      onPointerLeave={() => setTooltipsDismissed(false)}
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
            {view === 'kanban' ? 'Sessions' : 'Ideas'}
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
                data-tooltip={layout === 'grid' ? 'Grid layout' : 'List layout'}
                onClick={() => dispatch({ type: 'set-idea-layout', layout: layout as IdeaLayout })}
              >
                {layout === 'grid' ? <GridIcon /> : <ListIcon />}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className={styles.segmented} role="group" aria-label="Session layout">
            {(['kanban', 'grid'] as const).map((layout) => (
              <button
                key={layout}
                type="button"
                className={styles.segment}
                data-selected={state.sessionLayout === layout}
                aria-pressed={state.sessionLayout === layout}
                aria-label={layout === 'kanban' ? 'Kanban' : 'Grid'}
                data-tooltip={layout === 'kanban' ? 'Kanban layout' : 'Grid layout'}
                onClick={() =>
                  dispatch({ type: 'set-session-layout', layout: layout as SessionLayout })
                }
              >
                {layout === 'kanban' ? <BoardIcon /> : <GridIcon />}
              </button>
            ))}
          </div>
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
          <div className={styles.segmented} role="group" aria-label="Card detail">
            {(['titles', 'details'] as const).map((detail) => (
              <button
                key={detail}
                type="button"
                className={styles.segment}
                data-selected={state.kanbanCardDetail === detail}
                aria-pressed={state.kanbanCardDetail === detail}
                aria-label={detail === 'titles' ? 'Titles only' : 'Details'}
                data-tooltip={detail === 'titles' ? 'Titles only' : 'Full details'}
                onClick={() =>
                  dispatch({ type: 'set-kanban-card-detail', detail: detail as KanbanCardDetail })
                }
              >
                {detail === 'titles' ? <TitleIcon /> : <DetailsIcon />}
              </button>
            ))}
          </div>
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
        <Plus size={16} strokeWidth={1.7} aria-hidden="true" />
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
  const Icon = theme === 'system' ? Monitor : theme === 'light' ? Sun : Moon
  return <Icon size={15} strokeWidth={1.7} aria-hidden="true" />
}
