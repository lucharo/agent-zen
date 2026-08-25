import { currentPlanStep, planProgress, type ClassifiedAgentSession } from '@/domain/stage'
import { formatSessionTiming } from '@/domain/time'
import { Target } from 'lucide-react'
import {
  STAGE_LABELS,
  type AgentSession,
  type KanbanCardDetail,
  type LogbookNote,
} from '@/domain/types'
import type { BoardSession } from '@/state/store'
import { StageIcon } from './primitives'
import { QuickLogbook } from './QuickLogbook'
import styles from './SessionCard.module.css'

export interface SessionCardProps {
  entry: BoardSession
  now: number
  onOpen: (sessionId: string) => void
  columnIndex: number
  cardIndex: number
  detail: KanbanCardDetail
  comments: readonly LogbookNote[]
  showProject: boolean
  showStage?: boolean
}

export function SessionCard({
  entry,
  now,
  onOpen,
  columnIndex,
  cardIndex,
  detail,
  comments,
  showProject,
  showStage = false,
}: SessionCardProps) {
  const { session, stage, project, children } = entry
  const progress = planProgress(session)
  const idle = session.activity === 'idle'
  const needsUser = session.classification.needsUser
  const projectLabel = project?.name ?? 'Outside a Git project'
  const childLabel = children.length > 0
    ? `${children.length} ${children.length === 1 ? 'subagent' : 'subagents'}`
    : null
  const compactMeta = [needsUser ? '● Needs you' : idle ? 'Idle' : null, childLabel]
    .filter((value): value is string => Boolean(value))
    .join(' · ')
  const timing = formatSessionTiming(
    session.createdAt,
    session.activity === 'working' || session.activity === 'awaiting-input'
      ? session.turnStartedAt
      : null,
    now,
  )

  return (
    <li className={styles.slot}>
      <article className={styles.card} data-detail={detail}>
        <button
          type="button"
          className={styles.hit}
          data-card-id={session.id}
          data-column={columnIndex}
          data-index={cardIndex}
          onClick={() => onOpen(session.id)}
        >
          {showStage || showProject ? (
            <span className={styles.identity}>
              {showStage ? (
                <StageIcon stage={stage as Exclude<typeof stage, 'ideas'>} />
              ) : null}
              <span>
                {showStage ? STAGE_LABELS[stage] : null}
                {showStage && showProject ? ' · ' : null}
                {showProject ? projectLabel : null}
              </span>
            </span>
          ) : null}
          <div className={styles.titleRow}>
            <h3 className={styles.title}>{session.title}</h3>
            {session.goal ? (
              <span
                className={styles.goal}
                data-status={session.goal.status}
                aria-label={`Goal ${session.goal.status}: ${session.goal.objective}`}
                title={session.goal.objective}
              >
                <Target size={11} strokeWidth={1.8} aria-hidden="true" />
                Goal
              </span>
            ) : null}
          </div>
          {detail === 'titles' && compactMeta ? (
            <p
              className={needsUser ? styles.compactNeeds : styles.compactMeta}
              aria-live={needsUser ? 'polite' : undefined}
            >
              {compactMeta}
            </p>
          ) : null}
          {detail !== 'titles' && childLabel ? (
            <p className={styles.childSummary}>
              {childLabel}
            </p>
          ) : null}

          {detail !== 'titles' && stage === 'planning' ? (
            <p className={statusLineClass(needsUser)} aria-live={needsUser ? 'polite' : undefined}>
              {needsUser ? '● Needs you' : 'Planning · plan mode'}
            </p>
          ) : null}

          {detail !== 'titles' && stage === 'running' ? (
            <p className={statusLineClass(needsUser)} aria-live={needsUser ? 'polite' : undefined}>
              {runningSummary(session)}
            </p>
          ) : null}

          {detail !== 'titles' && stage === 'reviewing' && session.review ? (
            <p className={statusLineClass(needsUser)} aria-live={needsUser ? 'polite' : undefined}>
              {attentionPrefix(session)}{reviewSummary(session)}
            </p>
          ) : null}

          {detail !== 'titles' && stage === 'wrapping-up' && session.wrapup ? (
            <p className={statusLineClass(needsUser)} aria-live={needsUser ? 'polite' : undefined}>
              {attentionPrefix(session)}{wrapupSummary(session)}
            </p>
          ) : null}

          {detail === 'comments' && comments.length > 0 ? (
            <div className={styles.comments} aria-label="Your Logbook comments">
              <span className={styles.commentsLabel}>Comments</span>
              {[...comments].slice(-2).reverse().map((comment) => (
                <p key={comment.id}>{comment.body}</p>
              ))}
              {comments.length > 2 ? (
                <span className={styles.earlierComments}>+{comments.length - 2} earlier</span>
              ) : null}
            </div>
          ) : null}

          {timing ? <p className={styles.timing}>{timing}</p> : null}

          {(stage === 'planning' || stage === 'running') && progress ? (
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
        <QuickLogbook subjectId={session.id} subjectLabel={session.title} />
      </article>
    </li>
  )
}

function runningSummary(session: ClassifiedAgentSession): string {
  const step = currentPlanStep(session)
  if (session.classification.needsUser) return `● Needs you · ${step ?? 'waiting on your reply'}`
  if (session.activity === 'idle') return session.plan ? 'Idle · plan retained' : 'Idle · no plan'
  return step ?? (session.plan ? 'Between plan steps' : 'Working · no plan')
}

function attentionPrefix(session: ClassifiedAgentSession): string {
  if (session.classification.needsUser) return '● Needs you · '
  if (session.activity === 'idle') return 'Idle · '
  return ''
}

function statusLineClass(needsUser: boolean): string {
  return needsUser ? `${styles.line} ${styles.needs}` : `${styles.line}`
}

function reviewSummary(session: AgentSession): string {
  const review = session.review
  if (!review) return ''
  const details = [
    review.visualChecked === null
      ? null
      : review.visualChecked ? 'Visual checked' : 'Visual pending',
    review.pullRequest && review.prReady !== null
      ? (review.prReady ? 'PR ready' : 'PR draft')
      : null,
    review.openNotes === null
      ? null
      : `${review.openNotes} ${review.openNotes === 1 ? 'note' : 'notes'}`,
  ].filter((detail): detail is string => Boolean(detail))
  return details.length > 0 ? details.join(' · ') : 'Review in progress'
}

function wrapupSummary(session: AgentSession): string {
  const wrapup = session.wrapup
  if (!wrapup || wrapup.checksPassed === null || wrapup.checksTotal === null) {
    return 'Wrapup in progress'
  }
  return `wrapup · checks ${wrapup.checksPassed} / ${wrapup.checksTotal}`
}

/**
 * Hover and focus reveal the operational identity the card deliberately leaves
 * off. The detail sheet carries the same information for non-pointer users.
 */
function MetaPopover({ session }: { session: ClassifiedAgentSession }) {
  const worktree = session.worktree ?? session.cwd

  return (
    <div className={styles.popover} role="note">
      <span className={styles.caret} aria-hidden="true" />
      <dl className={styles.metaList}>
        <dt>Activity</dt>
        <dd>{activityLabel(session)}</dd>
        <dt>Goal</dt>
        <dd>{session.goal ? `${session.goal.status} · ${session.goal.objective}` : '—'}</dd>
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

function activityLabel(session: ClassifiedAgentSession): string {
  if (session.classification.needsUser) return 'Needs you'
  if (session.activity === 'working') return 'Turn running'
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
