import { currentPlanStep, planProgress } from '@/domain/stage'
import { formatDuration, elapsedSince, formatSessionTiming } from '@/domain/time'
import type { AgentSession } from '@/domain/types'
import type { BoardSession } from '@/state/store'
import styles from './SessionCard.module.css'

export interface SessionCardProps {
  entry: BoardSession
  now: number
  onOpen: (sessionId: string) => void
  columnIndex: number
  cardIndex: number
}

export function SessionCard({ entry, now, onOpen, columnIndex, cardIndex }: SessionCardProps) {
  const { session, stage, project, children } = entry
  const progress = planProgress(session)

  return (
    <li className={styles.slot}>
      <article className={styles.card}>
        <button
          type="button"
          className={styles.hit}
          data-card-id={session.id}
          data-column={columnIndex}
          data-index={cardIndex}
          onClick={() => onOpen(session.id)}
        >
          <h3 className={styles.title}>{session.title}</h3>
          <p className={styles.project}>{project?.name ?? 'No project'}</p>

          {stage === 'planning' ? (
            <p className={styles.line}>Starting · plan pending</p>
          ) : null}

          {stage === 'running' ? (
            <p className={styles.line}>{currentPlanStep(session) ?? 'Between plan steps'}</p>
          ) : null}

          {stage === 'reviewing' && session.review ? (
            <p className={styles.line}>{reviewSummary(session)}</p>
          ) : null}

          {stage === 'wrapping-up' && session.wrapup ? (
            <p className={styles.line}>
              wrapup · checks {session.wrapup.checksPassed} / {session.wrapup.checksTotal}
            </p>
          ) : null}

          {stage !== 'planning' ? (
            <p className={styles.timing}>
              {formatSessionTiming(session.createdAt, session.turnStartedAt, now)}
            </p>
          ) : null}

          {stage === 'running' && progress ? (
            <span className={styles.progress}>
              <span className={styles.progressCount}>
                {progress.completed} / {progress.total}
              </span>
              <span className={styles.track} aria-hidden="true">
                <span
                  className={styles.fill}
                  style={{ width: `${(progress.completed / progress.total) * 100}%` }}
                />
              </span>
            </span>
          ) : null}
        </button>

        <MetaPopover session={session} />
      </article>

      {children.length > 0 ? (
        <ul className={styles.children}>
          {children.map((child) => (
            <li key={child.id}>
              <button
                type="button"
                className={styles.child}
                data-card-id={child.id}
                data-column={columnIndex}
                data-index={cardIndex}
                onClick={() => onOpen(child.id)}
              >
                <span className={styles.childArrow} aria-hidden="true">
                  ↳
                </span>
                <span className={styles.childTitle}>{child.title}</span>
                <span className={styles.childTime}>
                  {formatDuration(elapsedSince(child.turnStartedAt ?? child.createdAt, now) ?? 0)}
                </span>
                <span className="visuallyHidden">Child agent</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  )
}

function reviewSummary(session: AgentSession): string {
  const review = session.review
  if (!review) return ''
  return [
    review.visualChecked ? 'Visual checked' : 'Visual pending',
    review.prReady ? 'PR ready' : 'PR draft',
    `${review.openNotes} ${review.openNotes === 1 ? 'note' : 'notes'}`,
  ].join(' · ')
}

/**
 * Hover and focus reveal only what the card deliberately leaves off: model,
 * repository, branch, worktree. Nothing already visible is repeated here, and
 * the same four rows are in the detail sheet for anyone not using a pointer.
 */
function MetaPopover({ session }: { session: AgentSession }) {
  return (
    <div className={styles.popover} role="note">
      <span className={styles.caret} aria-hidden="true" />
      <dl className={styles.metaList}>
        <dt>Model</dt>
        <dd>{session.model}</dd>
        <dt>Repository</dt>
        <dd>{session.repository ?? '—'}</dd>
        <dt>Branch</dt>
        <dd>{session.branch ?? '—'}</dd>
        <dt>Worktree</dt>
        <dd className={styles.path}>{session.worktree ?? session.cwd}</dd>
      </dl>
    </div>
  )
}
