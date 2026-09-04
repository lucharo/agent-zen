import { SESSION_LANES, SESSION_LANE_LABELS, sessionLane, type SessionLane } from '@/domain/lanes'
import type { KanbanGroupBy } from '@/domain/types'
import { useAgentZen, type BoardSession } from '@/state/store'
import { LaneIcon } from './primitives'
import { SessionCard } from './SessionCard'
import styles from './SessionGridView.module.css'

export interface SessionGridViewProps {
  onOpenSession: (sessionId: string) => void
}

export function SessionGridView({ onOpenSession }: SessionGridViewProps) {
  const { state, board, now, logbookFor } = useAgentZen()
  const entries = board.filter(
    (entry) => !state.projectFilter || entry.session.projectId === state.projectFilter,
  )
  const groups = groupSessions(entries, state.kanbanGroupBy)

  return (
    <section className={styles.wrap} aria-label="Session grid">
      {entries.length === 0 ? (
        <div className={styles.empty}>
          <strong>No active sessions</strong>
          <p>Agent sessions appear here when they enter planning.</p>
        </div>
      ) : (
        <div className={styles.scroller} data-constrain-width={state.constrainBoardWidth}>
          {groups.map((group) => (
            <div className={styles.group} key={group.key}>
              {state.kanbanGroupBy !== 'none' ? (
                <header className={styles.groupHead}>
                  {group.lane ? <LaneIcon lane={group.lane} /> : null}
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
                    comments={logbookFor(entry.session.id)}
                    showProject={state.kanbanGroupBy !== 'project'}
                    showStage={state.kanbanGroupBy !== 'state' || group.lane === 'needs-you'}
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

function groupSessions(entries: readonly BoardSession[], groupBy: KanbanGroupBy) {
  if (groupBy === 'none') return [{ key: 'all', label: '', entries, lane: null }]
  if (groupBy === 'state') {
    return SESSION_LANES.flatMap((lane) => {
      const laneEntries = entries.filter((entry) => sessionLane(entry) === lane)
      return laneEntries.length === 0
        ? []
        : [{ key: lane, label: SESSION_LANE_LABELS[lane], entries: laneEntries, lane }]
    })
  }
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
    .map(([key, group]) => ({ key, ...group, lane: null as SessionLane | null }))
    .sort((left, right) => left.label.localeCompare(right.label))
}
