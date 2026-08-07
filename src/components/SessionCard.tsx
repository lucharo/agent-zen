import { currentPlanStep, planProgress } from '@/domain/stage'
import { formatDuration, elapsedSince, formatSessionTiming } from '@/domain/time'
import { STAGE_LABELS, type AgentSession, type KanbanCardDetail } from '@/domain/types'
import type { BoardSession } from '@/state/store'
import { StageIcon } from './primitives'
import styles from './SessionCard.module.css'

export interface SessionCardProps {
  entry: BoardSession
  now: number
  onOpen: (sessionId: string) => void
  columnIndex: number
  cardIndex: number
  detail: KanbanCardDetail
  showProject: boolean
  showStage?: boolean
  showChildren?: boolean
}

export function SessionCard({
  entry,
  now,
  onOpen,
  columnIndex,
  cardIndex,
  detail,
  showProject,
  showStage = false,
  showChildren = true,
}: SessionCardProps) {
  const { session, stage, project, children } = entry
  const progress = planProgress(session)
  const idle = session.activity === 'idle'

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
          {showStage ? (
            <span className={styles.stage}>
              <StageIcon stage={stage as Exclude<typeof stage, 'ideas'>} />
              {STAGE_LABELS[stage]}
            </span>
          ) : null}
          <h3 className={styles.title}>{session.title}</h3>
          {detail === 'titles' && idle ? <p className={styles.idle}>Idle</p> : null}
          {detail === 'details' && showProject ? (
            <p className={styles.project}>{project?.name ?? 'Outside a Git project'}</p>
          ) : null}
          {!showChildren && children.length > 0 ? (
            <p className={styles.childSummary}>
              {children.length} {children.length === 1 ? 'subagent' : 'subagents'}
            </p>
          ) : null}

          {detail === 'details' && stage === 'planning' ? (
            <p className={styles.line}>{idle ? 'Idle · no current turn' : 'Starting · plan pending'}</p>
          ) : null}

          {detail === 'details' && stage === 'running' ? (
            <p className={styles.line}>
              {idle ? 'Idle · plan retained' : currentPlanStep(session) ?? 'Between plan steps'}
            </p>
          ) : null}

          {detail === 'details' && stage === 'reviewing' && session.review ? (
            <p className={styles.line}>{idle ? `Idle · ${reviewSummary(session)}` : reviewSummary(session)}</p>
          ) : null}

          {detail === 'details' && stage === 'wrapping-up' && session.wrapup ? (
            <p className={styles.line}>
              {idle ? 'Idle · ' : ''}wrapup · checks {session.wrapup.checksPassed} / {session.wrapup.checksTotal}
            </p>
          ) : null}

          {detail === 'details' && stage !== 'planning' ? (
            <p className={styles.timing}>
              {formatSessionTiming(
                session.createdAt,
                session.activity === 'working' ? session.turnStartedAt : null,
                now,
              )}
            </p>
          ) : null}

          {detail === 'details' && stage === 'running' && progress ? (
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

      {showChildren && children.length > 0 ? (
        <ul className={styles.children} aria-label={`Subagents of ${session.title}`}>
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
                  {child.activity === 'working'
                    ? formatDuration(elapsedSince(child.turnStartedAt ?? child.createdAt, now) ?? 0)
                    : 'idle'}
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
 * Hover and focus reveal the operational identity the card deliberately leaves
 * off. The detail sheet carries the same information for non-pointer users.
 */
function MetaPopover({ session }: { session: AgentSession }) {
  const worktree = session.worktree ?? session.cwd

  return (
    <div className={styles.popover} role="note">
      <span className={styles.caret} aria-hidden="true" />
      <dl className={styles.metaList}>
        <dt>Activity</dt>
        <dd>{activityLabel(session)}</dd>
        <dt>Model</dt>
        <dd>{session.model}</dd>
        <dt>Effort</dt>
        <dd>{session.reasoningEffort ?? '—'}</dd>
        <dt>Codex</dt>
        <dd>{session.cliVersion ?? '—'}</dd>
        <dt>Repository</dt>
        <dd>{session.repository ?? '—'}</dd>
        <dt>Branch</dt>
        <dd>{session.branch ?? '—'}</dd>
        <dt>Worktree</dt>
        <dd className={styles.path} aria-label={worktree}>
          {compactPath(worktree)}
        </dd>
        <dt>Thread</dt>
        <dd className={styles.path} aria-label={session.threadId}>
          {compactIdentifier(session.threadId)}
        </dd>
        <dt>Turn</dt>
        <dd className={styles.path} aria-label={session.turnId ?? 'No active turn'}>
          {session.turnId ? compactIdentifier(session.turnId) : '—'}
        </dd>
      </dl>
    </div>
  )
}

function activityLabel(session: AgentSession): string {
  if (session.activity === 'working') return 'Turn running'
  if (session.activity === 'awaiting-input') return 'Awaiting input'
  if (session.activity === 'idle') return 'Session open · between turns'
  return 'Ended'
}

function compactPath(path: string): string {
  return path.replace(/^\/(?:Users|home)\/[^/]+\//, '~/')
}

function compactIdentifier(identifier: string): string {
  if (identifier.length <= 13) return identifier
  return `${identifier.slice(0, 8)}…${identifier.slice(-4)}`
}
