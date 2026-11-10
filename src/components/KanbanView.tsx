import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { SESSION_LANES, SESSION_LANE_LABELS, sessionLane } from '@/domain/lanes'
import { STAGE_LABELS, type Idea } from '@/domain/types'
import { useAgentZen, type BoardSession } from '@/state/store'
import { Chevron, LaneIcon } from './primitives'
import { QuickLogbook } from './QuickLogbook'
import { SessionCard } from './SessionCard'
import styles from './KanbanView.module.css'
import { NO_PROJECT_LABEL } from '@/domain/projectLabel'

export interface KanbanViewProps {
  ideas: readonly Idea[]
  onOpenSession: (sessionId: string) => void
  onOpenIdea: (ideaId: string) => void
  onCapture: () => void
}

export function KanbanView({ ideas, onOpenSession, onOpenIdea, onCapture }: KanbanViewProps) {
  const { state, dispatch, board, now, availableProjects, logbookFor } = useAgentZen()
  const boardRef = useRef<HTMLDivElement>(null)
  const [boardEdges, setBoardEdges] = useState({ left: false, right: false })

  const filtered = state.projectFilter
    ? board.filter((entry) => entry.session.projectId === state.projectFilter)
    : board
  const laneSignature = filtered.map((entry) => `${entry.session.id}:${sessionLane(entry)}`).join('|')
  const foldedLaneSignature = state.foldedSessionLanes.join('|')

  const updateBoardEdges = useCallback(() => {
    const node = boardRef.current
    if (!node) return
    const maxScroll = node.scrollWidth - node.clientWidth
    const next = {
      left: node.scrollLeft > 1,
      right: maxScroll - node.scrollLeft > 1,
    }
    setBoardEdges((current) => (
      current.left === next.left && current.right === next.right ? current : next
    ))
  }, [])

  useLayoutEffect(() => {
    updateBoardEdges()
    window.addEventListener('resize', updateBoardEdges)
    return () => window.removeEventListener('resize', updateBoardEdges)
  }, [
    ideas.length,
    laneSignature,
    foldedLaneSignature,
    state.ideasFolded,
    state.kanbanGroupBy,
    state.showCollapsedLanes,
    updateBoardEdges,
  ])

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']
    if (!keys.includes(event.key)) return
    const root = boardRef.current
    const current = document.activeElement as HTMLElement | null
    if (!root || !current?.dataset.cardId) return

    const cards = Array.from(root.querySelectorAll<HTMLElement>('[data-card-id]'))
    const byColumn = new Map<number, HTMLElement[]>()
    for (const card of cards) {
      const column = Number(card.dataset.column ?? 0)
      byColumn.set(column, [...(byColumn.get(column) ?? []), card])
    }

    const column = Number(current.dataset.column ?? 0)
    const columnCards = byColumn.get(column) ?? []
    const row = columnCards.indexOf(current)
    let target: HTMLElement | undefined
    if (event.key === 'ArrowDown') target = columnCards[row + 1]
    if (event.key === 'ArrowUp') target = columnCards[row - 1]
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      const step = event.key === 'ArrowRight' ? 1 : -1
      for (let next = column + step; next >= 0 && next <= SESSION_LANES.length; next += step) {
        const candidates = byColumn.get(next)
        if (candidates?.length) {
          target = candidates[Math.min(row, candidates.length - 1)]
          break
        }
      }
    }

    if (target) {
      event.preventDefault()
      target.focus()
    }
  }, [])

  return (
    <div
      className={styles.wrap}
      data-overflow-left={boardEdges.left}
      data-overflow-right={boardEdges.right}
    >
      <div
        className={styles.board}
        data-ideas-folded={state.ideasFolded}
        data-constrain-width={state.constrainBoardWidth}
        ref={boardRef}
        onKeyDown={onKeyDown}
        onScroll={updateBoardEdges}
      >
        {state.ideasFolded && !state.showCollapsedLanes ? null : <section
          className={styles.column}
          data-folded={state.ideasFolded}
          aria-label={STAGE_LABELS.ideas}
        >
          <header className={styles.columnHead}>
            <button
              type="button"
              className={styles.fold}
              data-folded={state.ideasFolded}
              aria-expanded={!state.ideasFolded}
              onClick={() => dispatch({ type: 'toggle-ideas-fold' })}
              title={state.ideasFolded ? 'Expand Ideas' : 'Collapse Ideas to the left'}
            >
              <Chevron direction={state.ideasFolded ? 'right' : 'left'} />
              <h2 className={styles.columnTitle}>{STAGE_LABELS.ideas}</h2>
            </button>
            <span className={styles.count}>
              <span aria-hidden="true">{ideas.length}</span>
              <span className="visuallyHidden">{ideas.length} ideas</span>
            </span>
            <button
              type="button"
              className={styles.columnAdd}
              onClick={onCapture}
              title="Capture an idea"
            >
              <span aria-hidden="true">+</span>
              <span className="visuallyHidden">Capture an idea</span>
            </button>
          </header>

          {state.ideasFolded ? null : (
            <ScrollableColumn contentKey={ideas.length === 0 ? 'empty' : 'filled'}>
              <ul className={styles.stack}>
                {ideas.slice(0, 4).map((idea, index) => (
                  <li key={idea.id}>
                    <article className={styles.ideaCard}>
                      <button
                        type="button"
                        className={styles.ideaHit}
                        data-card-id={idea.id}
                        data-column={0}
                        data-index={index}
                        onClick={() => onOpenIdea(idea.id)}
                      >
                        <span className={styles.ideaTitle}>{idea.title}</span>
                        <span className={styles.ideaMeta}>
                          {projectName(availableProjects, idea.projectId)}
                        </span>
                      </button>
                      <QuickLogbook subjectId={idea.id} subjectLabel={idea.title} />
                    </article>
                  </li>
                ))}
                {ideas.length > 4 ? (
                  <li>
                    <button
                      type="button"
                      className={styles.more}
                      onClick={() => dispatch({ type: 'set-view', view: 'ideas' })}
                    >
                      {ideas.length - 4} more in Ideas
                    </button>
                  </li>
                ) : null}
                {ideas.length === 0 ? <li className={styles.empty}>Nothing captured yet</li> : null}
              </ul>
            </ScrollableColumn>
          )}
        </section>}

        {SESSION_LANES.map((lane, laneIndex) => {
          const entries = filtered.filter((entry) => sessionLane(entry) === lane)
          const groups = groupSessions(entries, state.kanbanGroupBy === 'project')
          const empty = entries.length === 0
          const folded = empty || state.foldedSessionLanes.includes(lane)
          if (folded && !state.showCollapsedLanes) return null
          return (
            <section
              className={styles.column}
              data-lane={lane}
              data-empty={empty}
              data-folded={folded}
              data-highlight={lane === 'needs-you' && state.highlightNeedsYou}
              key={lane}
              aria-label={SESSION_LANE_LABELS[lane]}
            >
              <header className={styles.columnHead}>
                <button
                  type="button"
                  className={styles.fold}
                  data-folded={folded}
                  aria-label={folded
                    ? `Expand ${SESSION_LANE_LABELS[lane]}`
                    : `Collapse ${SESSION_LANE_LABELS[lane]}`}
                  aria-expanded={!folded}
                  disabled={empty}
                  onClick={() => dispatch({ type: 'toggle-session-lane-fold', lane })}
                  title={empty
                    ? `${SESSION_LANE_LABELS[lane]} is empty`
                    : folded
                    ? `Expand ${SESSION_LANE_LABELS[lane]}`
                    : `Collapse ${SESSION_LANE_LABELS[lane]}`}
                >
                  {empty ? null : <Chevron direction={folded ? 'right' : 'left'} />}
                  <span className={styles.stageMark}>
                    <LaneIcon lane={lane} />
                  </span>
                </button>
                <h2 className={styles.columnTitle}>{SESSION_LANE_LABELS[lane]}</h2>
                <span className={styles.count}>
                  <span aria-hidden="true">{entries.length}</span>
                  <span className="visuallyHidden">{entries.length} sessions</span>
                </span>
              </header>
              {folded ? null : (
                <ScrollableColumn contentKey={`${lane}:${entries.length}`}>
                  <div className={styles.groups}>
                    {groups.map((group) => (
                      <section className={styles.projectGroup} key={group.key}>
                        {state.kanbanGroupBy === 'project' ? (
                          <header className={styles.projectHead}>
                            <span>{group.label}</span>
                            <span>{group.entries.length}</span>
                          </header>
                        ) : null}
                        <ul className={styles.stack}>
                          {group.entries.map((entry, index) => (
                            <SessionCard
                              key={entry.session.id}
                              entry={entry}
                              now={now}
                              onOpen={onOpenSession}
                              columnIndex={laneIndex + 1}
                              cardIndex={index}
                              detail={state.kanbanCardDetail}
                              comments={logbookFor(entry.session.id)}
                              showProject={state.kanbanGroupBy !== 'project'}
                              showStage={lane === 'needs-you'}
                            />
                          ))}
                        </ul>
                      </section>
                    ))}
                  </div>
                </ScrollableColumn>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}

function ScrollableColumn({ children, contentKey }: { children: ReactNode; contentKey: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [scrollable, setScrollable] = useState(false)
  const [atEnd, setAtEnd] = useState(true)

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const measure = () => {
      const canScroll = element.scrollHeight > element.clientHeight + 2
      setScrollable(canScroll)
      setAtEnd(!canScroll || element.scrollTop + element.clientHeight >= element.scrollHeight - 2)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    for (const child of Array.from(element.children)) observer.observe(child)
    return () => observer.disconnect()
  }, [contentKey])

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const onScroll = () =>
      setAtEnd(element.scrollTop + element.clientHeight >= element.scrollHeight - 2)
    element.addEventListener('scroll', onScroll, { passive: true })
    return () => element.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <div className={styles.scrollFrame} data-scrollable={scrollable} data-at-end={atEnd}>
      <div
        className={styles.columnScroll}
        data-column-scroll
        ref={ref}
        tabIndex={scrollable ? 0 : undefined}
      >
        {children}
      </div>
      {scrollable && !atEnd ? <span className={styles.scrollHint}>Scroll for more</span> : null}
    </div>
  )
}

function groupSessions(entries: readonly BoardSession[], byProject: boolean) {
  if (!byProject) return [{ key: 'all', label: '', entries }]
  const grouped = new Map<string, { label: string; entries: BoardSession[] }>()
  for (const entry of entries) {
    const key = entry.project?.id ?? 'no-project'
    const group = grouped.get(key) ?? {
      label: entry.project?.name ?? NO_PROJECT_LABEL,
      entries: [],
    }
    group.entries.push(entry)
    grouped.set(key, group)
  }
  return [...grouped.entries()]
    .map(([key, group]) => ({ key, ...group }))
    .sort((left, right) => left.label.localeCompare(right.label))
}

function projectName(projects: readonly { id: string; name: string }[], projectId: string | null) {
  if (!projectId) return 'No project'
  return projects.find((project) => project.id === projectId)?.name ?? 'No project'
}
