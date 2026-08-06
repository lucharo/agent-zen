import { useState } from 'react'
import { groupIdeas } from '@/domain/ideas'
import { formatCaptureTime } from '@/domain/time'
import type { Idea } from '@/domain/types'
import { useAgentZen } from '@/state/store'
import { Chevron } from './primitives'
import styles from './IdeasView.module.css'

export interface IdeasViewProps {
  ideas: readonly Idea[]
  onOpenIdea: (ideaId: string) => void
}

export function IdeasView({ ideas, onOpenIdea }: IdeasViewProps) {
  const { state, now, projectById, logbookFor } = useAgentZen()
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())

  const groups = groupIdeas(ideas, {
    groupBy: state.ideaGroupBy,
    projects: state.projects,
    now,
  })

  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  if (groups.length === 0) {
    return (
      <div className={styles.wrap}>
        <p className={styles.emptyAll}>
          No ideas match this filter. Press <kbd>⌘N</kbd> to capture one.
        </p>
      </div>
    )
  }

  return (
    <div className={styles.wrap} data-layout={state.ideaLayout}>
      {groups.map((group) => {
        const isCollapsed = collapsed.has(group.key)
        return (
          <section className={styles.group} key={group.key}>
            <button
              type="button"
              className={styles.groupHead}
              aria-expanded={!isCollapsed}
              onClick={() => toggle(group.key)}
            >
              <Chevron direction={isCollapsed ? 'right' : 'down'} />
              <h2 className={styles.groupTitle}>{group.label}</h2>
              <span className={styles.groupCount}>{group.ideas.length}</span>
            </button>

            {isCollapsed ? null : (
              <ul className={styles.items} data-layout={state.ideaLayout}>
                {group.ideas.map((idea) => {
                  const noteCount = logbookFor(idea.id).length
                  return (
                    <li key={idea.id}>
                      <button
                        type="button"
                        className={styles.item}
                        data-layout={state.ideaLayout}
                        onClick={() => onOpenIdea(idea.id)}
                      >
                        <span className={styles.itemTitle}>{idea.title}</span>
                        <span className={styles.itemTime}>
                          {formatCaptureTime(idea.createdAt, now)}
                        </span>
                        <span className={styles.itemProject}>
                          {projectById(idea.projectId)?.name ?? 'No project'}
                        </span>
                        {noteCount > 0 ? (
                          <span className={styles.itemNotes}>
                            {noteCount} logbook {noteCount === 1 ? 'note' : 'notes'}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        )
      })}
    </div>
  )
}
