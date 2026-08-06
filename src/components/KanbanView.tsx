import { useCallback, useRef, type KeyboardEvent } from 'react'
import { SESSION_STAGES, STAGE_LABELS, type Idea, type Stage } from '@/domain/types'
import { useAgentZen } from '@/state/store'
import { Chevron, StageIcon } from './primitives'
import { SessionCard } from './SessionCard'
import styles from './KanbanView.module.css'

export interface KanbanViewProps {
  ideas: readonly Idea[]
  onOpenSession: (sessionId: string) => void
  onOpenIdea: (ideaId: string) => void
  onOpenArchive: () => void
  onCapture: () => void
}

/** Five equal columns. Ideas folds; the other four are agent-backed. */
export function KanbanView({
  ideas,
  onOpenSession,
  onOpenIdea,
  onOpenArchive,
  onCapture,
}: KanbanViewProps) {
  const { state, dispatch, board, archived, now } = useAgentZen()
  const boardRef = useRef<HTMLDivElement>(null)

  const filtered = state.projectFilter
    ? board.filter((entry) => entry.session.projectId === state.projectFilter)
    : board

  /**
   * Arrow keys move between cards; the DOM order inside a column already gives
   * us Tab, so this only has to handle across-column movement and vertical
   * jumps within one column.
   */
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
      for (let next = column + step; next >= 0 && next < 5; next += step) {
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

  const hiddenIdeaCount = ideas.length

  return (
    <div className={styles.wrap}>
      <div
        className={styles.board}
        data-ideas-folded={state.ideasFolded}
        ref={boardRef}
        onKeyDown={onKeyDown}
      >
        <section
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
            {state.ideasFolded ? (
              <span className={styles.hiddenCount} title={`${hiddenIdeaCount} ideas hidden`}>
                {hiddenIdeaCount}
                <span className="visuallyHidden"> ideas hidden</span>
              </span>
            ) : null}
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
            <ul className={styles.stack}>
              {ideas.slice(0, 4).map((idea, index) => (
                <li key={idea.id}>
                  <button
                    type="button"
                    className={styles.ideaCard}
                    data-card-id={idea.id}
                    data-column={0}
                    data-index={index}
                    onClick={() => onOpenIdea(idea.id)}
                  >
                    <span className={styles.ideaTitle}>{idea.title}</span>
                    <span className={styles.ideaMeta}>
                      {projectName(state.projects, idea.projectId)}
                    </span>
                  </button>
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
          )}
        </section>

        {SESSION_STAGES.map((stage, stageIndex) => {
          const entries = filtered.filter((entry) => entry.stage === stage)
          return (
            <section
              className={styles.column}
              data-stage={stage}
              key={stage}
              aria-label={STAGE_LABELS[stage]}
            >
              <header className={styles.columnHead}>
                <span className={styles.stageMark}>
                  <StageIcon stage={stage} />
                  <span className="visuallyHidden">Codex</span>
                </span>
                <h2 className={styles.columnTitle}>{STAGE_LABELS[stage]}</h2>
              </header>
              <ul className={styles.stack}>
                {entries.map((entry, index) => (
                  <SessionCard
                    key={entry.session.id}
                    entry={entry}
                    now={now}
                    onOpen={onOpenSession}
                    columnIndex={stageIndex + 1}
                    cardIndex={index}
                  />
                ))}
                {entries.length === 0 ? (
                  <li className={styles.empty}>{emptyLabel(stage)}</li>
                ) : null}
              </ul>
            </section>
          )
        })}
      </div>

      <footer className={styles.footer}>
        <button type="button" className={styles.archiveLink} onClick={onOpenArchive}>
          {archived.length} finished {archived.length === 1 ? 'session' : 'sessions'} in history
        </button>
      </footer>
    </div>
  )
}

function projectName(
  projects: ReturnType<typeof useAgentZen>['state']['projects'],
  projectId: string | null,
): string {
  if (!projectId) return 'No project'
  return projects.find((p) => p.id === projectId)?.name ?? projectId
}

function emptyLabel(stage: Stage): string {
  switch (stage) {
    case 'planning':
      return 'Nothing starting'
    case 'running':
      return 'Nothing in flight'
    case 'reviewing':
      return 'Nothing to review'
    default:
      return 'Nothing closing out'
  }
}
