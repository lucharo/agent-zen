import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { AGENT_KINDS, AGENT_LABELS, STAGE_LABELS } from '@/domain/types'
import { captureShortcutLabel } from '@/keyboard'
import { useAgentZen } from '@/state/store'
import { Overlay } from './primitives'
import styles from './CommandPalette.module.css'

interface Command {
  readonly id: string
  readonly label: string
  readonly group: 'Go' | 'Do' | 'Sessions' | 'Ideas'
  readonly detail?: string
  readonly shortcut?: string
  readonly run: () => void
}

export interface CommandPaletteProps {
  open: boolean
  onClose: () => void
  onOpenSession: (sessionId: string) => void
  onOpenIdea: (ideaId: string) => void
  onOpenCapture: () => void
  onOpenSettings: () => void
}

export function CommandPalette({
  open,
  onClose,
  onOpenSession,
  onOpenIdea,
  onOpenCapture,
  onOpenSettings,
}: CommandPaletteProps) {
  const { state, dispatch, board, projectById, availableProjects } = useAgentZen()
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)
  const sessionGroupBy = state.sessionLayout === 'kanban' && state.kanbanGroupBy === 'state'
    ? 'none'
    : state.kanbanGroupBy

  useEffect(() => {
    if (open) {
      setQuery('')
      setCursor(0)
    }
  }, [open])

  const commands = useMemo<Command[]>(() => {
    const go: Command[] = [
      {
        id: 'go-kanban',
        label: 'Go to Sessions',
        shortcut: '⌘1',
        group: 'Go',
        run: () => dispatch({ type: 'set-view', view: 'kanban' }),
      },
      {
        id: 'go-ideas',
        label: 'Go to Ideas',
        shortcut: '⌘2',
        group: 'Go',
        run: () => dispatch({ type: 'set-view', view: 'ideas' }),
      },
      { id: 'go-settings', label: 'Open Settings', shortcut: '⌘,', group: 'Go', run: onOpenSettings },
    ]

    const doCommands: Command[] = [
      { id: 'do-capture', label: 'Capture an idea', shortcut: captureShortcutLabel(), group: 'Do', run: onOpenCapture },
      {
        id: 'do-fold',
        label: state.ideasFolded ? 'Unfold the Ideas column' : 'Fold the Ideas column',
        group: 'Do',
        run: () => dispatch({ type: 'toggle-ideas-fold' }),
      },
      {
        id: 'do-layout',
        label: state.ideaLayout === 'grid' ? 'Show ideas as a list' : 'Show ideas as a grid',
        group: 'Do',
        run: () =>
          dispatch({
            type: 'set-idea-layout',
            layout: state.ideaLayout === 'grid' ? 'list' : 'grid',
          }),
      },
      {
        id: 'do-group',
        label: state.ideaGroupBy === 'created' ? 'Group ideas by project' : 'Group ideas by date',
        group: 'Do',
        run: () =>
          dispatch({
            type: 'set-idea-group-by',
            groupBy: state.ideaGroupBy === 'created' ? 'project' : 'created',
          }),
      },
      {
        id: 'do-kanban-group',
        label: sessionGroupBy === 'project'
          ? 'Stop grouping sessions by project'
          : sessionGroupBy === 'state'
            ? 'Stop grouping sessions by state'
            : 'Group sessions by project',
        group: 'Do',
        run: () =>
          dispatch({
            type: 'set-kanban-group-by',
            groupBy: sessionGroupBy !== 'none' ? 'none' : 'project',
          }),
      },
      {
        id: 'do-session-layout',
        label:
          state.sessionLayout === 'kanban'
            ? 'Show sessions as a grid'
            : 'Show sessions as a Kanban',
        group: 'Do',
        run: () =>
          dispatch({
            type: 'set-session-layout',
            layout: state.sessionLayout === 'kanban' ? 'grid' : 'kanban',
          }),
      },
      {
        id: 'do-card-detail',
        label: state.kanbanCardDetail === 'titles' ? 'Show session descriptions' : 'Show session titles only',
        group: 'Do',
        run: () =>
          dispatch({
            type: 'set-kanban-card-detail',
            detail: state.kanbanCardDetail === 'titles' ? 'details' : 'titles',
          }),
      },
      ...AGENT_KINDS.map((agent) => ({
        id: `do-agent-${agent}`,
        label: state.visibleAgents.includes(agent)
          ? `Hide ${AGENT_LABELS[agent]} sessions`
          : `Show ${AGENT_LABELS[agent]} sessions`,
        group: 'Do' as const,
        run: () => dispatch({ type: 'toggle-agent-visibility', agent }),
      })),
      ...(['system', 'light', 'dark'] as const).map((theme) => ({
        id: `do-theme-${theme}`,
        label: `Theme: ${theme[0]!.toUpperCase()}${theme.slice(1)}`,
        group: 'Do' as const,
        run: () => dispatch({ type: 'set-theme', theme }),
      })),
      ...availableProjects.map((project) => ({
        id: `do-filter-${project.id}`,
        label: `Filter to ${project.name}`,
        detail: project.repository ?? project.directory,
        group: 'Do' as const,
        run: () => dispatch({ type: 'set-project-filter', projectId: project.id }),
      })),
      {
        id: 'do-filter-all',
        label: 'Clear the project filter',
        group: 'Do',
        run: () => dispatch({ type: 'set-project-filter', projectId: null }),
      },
    ]

    const sessions: Command[] = board.flatMap((entry) => [
      {
        id: `session-${entry.session.id}`,
        label: entry.session.title,
        detail: `${STAGE_LABELS[entry.stage]} · ${entry.project?.name ?? 'Outside a Git project'}`,
        group: 'Sessions' as const,
        run: () => onOpenSession(entry.session.id),
      },
      ...entry.children.map((child) => ({
        id: `session-${child.id}`,
        label: child.title,
        detail: `Child agent · ${projectById(child.projectId)?.name ?? 'Outside a Git project'}`,
        group: 'Sessions' as const,
        run: () => onOpenSession(child.id),
      })),
    ])

    const ideas: Command[] = state.ideas.slice(0, 40).map((idea) => ({
      id: `idea-${idea.id}`,
      label: idea.title,
      detail: projectById(idea.projectId)?.name ?? 'No project',
      group: 'Ideas' as const,
      run: () => onOpenIdea(idea.id),
    }))

    return [...go, ...doCommands, ...sessions, ...ideas]
  }, [state, sessionGroupBy, dispatch, board, projectById, availableProjects, onOpenSession, onOpenIdea, onOpenCapture, onOpenSettings])

  const needle = query.trim().toLowerCase()
  const results = needle
    ? commands.filter(
        (c) =>
          c.label.toLowerCase().includes(needle) || c.detail?.toLowerCase().includes(needle),
      )
    : commands
  const visible = results.slice(0, 12)
  const active = Math.min(cursor, Math.max(0, visible.length - 1))

  const runAt = (index: number) => {
    const command = visible[index]
    if (!command) return
    command.run()
    onClose()
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setCursor((c) => Math.min(c + 1, visible.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setCursor((c) => Math.max(c - 1, 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      runAt(active)
    }
  }

  return (
    <Overlay
      open={open}
      onClose={onClose}
      labelledBy="palette-title"
      variant="palette"
      testId="command-palette"
    >
      <div className={styles.palette} onKeyDown={onKeyDown}>
        <h2 id="palette-title" className="visuallyHidden">
          Command palette
        </h2>
        <input
          className={styles.input}
          placeholder="Search or jump…"
          aria-label="Search or jump to"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls="command-palette-results"
          aria-activedescendant={visible[active] ? `command-${visible[active].id}` : undefined}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setCursor(0)
          }}
        />
        {visible.length === 0 ? (
          <p className={styles.noResults}>No matches</p>
        ) : (
          <ul
            id="command-palette-results"
            className={styles.results}
            ref={listRef}
            role="listbox"
            aria-label="Results"
          >
            {visible.map((command, index) => {
              const isNewGroup = index === 0 || visible[index - 1]?.group !== command.group
              return (
                <Fragment key={command.id}>
                  {isNewGroup ? (
                    <li className={styles.groupLabel} role="presentation" aria-hidden="true">
                      {command.group}
                    </li>
                  ) : null}
                  <li
                    id={`command-${command.id}`}
                    role="option"
                    aria-selected={index === active}
                    className={styles.result}
                    data-active={index === active}
                    onMouseEnter={() => setCursor(index)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => runAt(index)}
                  >
                    <span className={styles.resultLabel}>{command.label}</span>
                    {command.detail ? (
                      <span className={styles.resultDetail}>{command.detail}</span>
                    ) : null}
                    {command.shortcut ? (
                      <kbd className={styles.shortcut}>{command.shortcut}</kbd>
                    ) : null}
                  </li>
                </Fragment>
              )
            })}
          </ul>
        )}
      </div>
    </Overlay>
  )
}
