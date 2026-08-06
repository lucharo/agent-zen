import { useEffect, useMemo, useRef, useState } from 'react'
import { STAGE_LABELS } from '@/domain/types'
import { useAgentZen } from '@/state/store'
import { Overlay } from './primitives'
import styles from './CommandPalette.module.css'

interface Command {
  readonly id: string
  readonly label: string
  readonly group: 'Go' | 'Do' | 'Sessions' | 'Ideas'
  readonly detail?: string
  readonly run: () => void
}

export interface CommandPaletteProps {
  open: boolean
  onClose: () => void
  onOpenSession: (sessionId: string) => void
  onOpenIdea: (ideaId: string) => void
  onOpenCapture: () => void
  onOpenArchive: () => void
  onOpenSettings: () => void
}

export function CommandPalette({
  open,
  onClose,
  onOpenSession,
  onOpenIdea,
  onOpenCapture,
  onOpenArchive,
  onOpenSettings,
}: CommandPaletteProps) {
  const { state, dispatch, board, projectById } = useAgentZen()
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)

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
        label: 'Go to Kanban',
        group: 'Go',
        run: () => dispatch({ type: 'set-view', view: 'kanban' }),
      },
      {
        id: 'go-ideas',
        label: 'Go to Ideas',
        group: 'Go',
        run: () => dispatch({ type: 'set-view', view: 'ideas' }),
      },
      { id: 'go-archive', label: 'Open history', group: 'Go', run: onOpenArchive },
      { id: 'go-settings', label: 'Open Settings', detail: '⌘,', group: 'Go', run: onOpenSettings },
    ]

    const doCommands: Command[] = [
      { id: 'do-capture', label: 'Capture an idea', detail: '⌘N', group: 'Do', run: onOpenCapture },
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
      ...(['system', 'light', 'dark'] as const).map((theme) => ({
        id: `do-theme-${theme}`,
        label: `Theme: ${theme[0]!.toUpperCase()}${theme.slice(1)}`,
        group: 'Do' as const,
        run: () => dispatch({ type: 'set-theme', theme }),
      })),
      ...state.projects.map((project) => ({
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
        detail: `${STAGE_LABELS[entry.stage]} · ${entry.project?.name ?? 'No project'}`,
        group: 'Sessions' as const,
        run: () => onOpenSession(entry.session.id),
      },
      ...entry.children.map((child) => ({
        id: `session-${child.id}`,
        label: child.title,
        detail: `Child agent · ${projectById(child.projectId)?.name ?? 'No project'}`,
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
  }, [state, dispatch, board, projectById, onOpenSession, onOpenIdea, onOpenCapture, onOpenArchive, onOpenSettings])

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
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setCursor(0)
          }}
        />
        {visible.length === 0 ? (
          <p className={styles.noResults}>No matches</p>
        ) : (
          <ul className={styles.results} ref={listRef} role="listbox" aria-label="Results">
            {visible.map((command, index) => {
              const isNewGroup = index === 0 || visible[index - 1]?.group !== command.group
              return (
                <li key={command.id}>
                  {isNewGroup ? <p className={styles.groupLabel}>{command.group}</p> : null}
                  <button
                    type="button"
                    role="option"
                    aria-selected={index === active}
                    className={styles.result}
                    data-active={index === active}
                    onMouseEnter={() => setCursor(index)}
                    onClick={() => runAt(index)}
                  >
                    <span className={styles.resultLabel}>{command.label}</span>
                    {command.detail ? (
                      <span className={styles.resultDetail}>{command.detail}</span>
                    ) : null}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </Overlay>
  )
}
