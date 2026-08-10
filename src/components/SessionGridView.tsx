import { useAgentZen, type BoardSession } from '@/state/store'
import { SessionCard } from './SessionCard'
import styles from './SessionGridView.module.css'

export interface SessionGridViewProps {
  onOpenSession: (sessionId: string) => void
}

export function SessionGridView({ onOpenSession }: SessionGridViewProps) {
  const { state, board, now } = useAgentZen()
  const entries = board.filter(
    (entry) => !state.projectFilter || entry.session.projectId === state.projectFilter,
  )
  const groups = groupSessions(entries, state.kanbanGroupBy === 'project')

  return (
    <section className={styles.wrap} aria-label="Session grid">
      {entries.length === 0 ? (
        <div className={styles.empty}>
          <strong>No active sessions</strong>
          <p>Codex sessions appear here when they enter planning.</p>
        </div>
      ) : (
        <div className={styles.scroller}>
          {groups.map((group) => (
            <div className={styles.group} key={group.key}>
              {state.kanbanGroupBy === 'project' ? (
                <header className={styles.groupHead}>
                  <h2>{group.label}</h2>
                  <span>{group.entries.length}</span>
                </header>
              ) : null}
              <ul className={styles.grid} data-detail={state.kanbanCardDetail}>
                {group.entries.map((entry, index) => (
                  <SessionCard
                    key={entry.session.id}
                    entry={entry}
                    now={now}
                    onOpen={onOpenSession}
                    columnIndex={0}
                    cardIndex={index}
                    detail={state.kanbanCardDetail}
                    showProject={state.kanbanGroupBy !== 'project'}
                    showStage
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function groupSessions(entries: readonly BoardSession[], byProject: boolean) {
  if (!byProject) return [{ key: 'all', label: '', entries }]
  const grouped = new Map<string, { label: string; entries: BoardSession[] }>()
  for (const entry of entries) {
    const key = entry.project?.id ?? 'outside-git'
    const group = grouped.get(key) ?? {
      label: entry.project?.name ?? 'Outside a Git project',
      entries: [],
    }
    group.entries.push(entry)
    grouped.set(key, group)
  }
  return [...grouped.entries()]
    .map(([key, group]) => ({ key, ...group }))
    .sort((left, right) => left.label.localeCompare(right.label))
}
