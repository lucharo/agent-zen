import { useState } from 'react'
import { deriveStage } from '@/domain/stage'
import { elapsedSince, formatCaptureTime, formatDuration } from '@/domain/time'
import { STAGE_LABELS, type AgentSession, type SemanticEventKind } from '@/domain/types'
import { useAgentZen } from '@/state/store'
import { Chevron, CodexMark, Overlay } from './primitives'
import { Logbook } from './Logbook'
import styles from './DetailSheet.module.css'

export type DetailTarget =
  | { kind: 'session'; id: string }
  | { kind: 'idea'; id: string }
  | null

export interface DetailSheetProps {
  target: DetailTarget
  onClose: () => void
}

export function DetailSheet({ target, onClose }: DetailSheetProps) {
  const { sessions, state } = useAgentZen()

  const session = target?.kind === 'session' ? sessions.find((s) => s.id === target.id) : undefined
  const idea = target?.kind === 'idea' ? state.ideas.find((i) => i.id === target.id) : undefined

  return (
    <Overlay
      open={Boolean(session || idea)}
      onClose={onClose}
      labelledBy="detail-title"
      variant="sheet"
      testId="detail-sheet"
    >
      {session ? <SessionDetail session={session} onClose={onClose} /> : null}
      {idea ? <IdeaDetail ideaId={idea.id} onClose={onClose} /> : null}
    </Overlay>
  )
}

const EVENTS: ReadonlyArray<{ kind: SemanticEventKind; label: string }> = [
  { kind: 'review-requested', label: 'Request review' },
  { kind: 'wrapup-invoked', label: 'Mark wrapping up' },
  { kind: 'returned-to-work', label: 'Return to work' },
]

function SessionDetail({ session, onClose }: { session: AgentSession; onClose: () => void }) {
  const { state, dispatch, now, projectById } = useAgentZen()
  const [showHistory, setShowHistory] = useState(false)
  const stage = deriveStage(session, {
    override: state.overrides.find((o) => o.sessionId === session.id),
    events: state.events,
  })
  const project = projectById(session.projectId)
  const age = elapsedSince(session.createdAt, now)
  const turn = elapsedSince(session.turnStartedAt, now)

  return (
    <>
      <SheetHeader
        title={session.title}
        subtitle={`${stage ? STAGE_LABELS[stage] : 'History'} · ${project?.name ?? 'No project'}`}
        onClose={onClose}
      />

      <div className={styles.body}>
        <section className={styles.native} aria-labelledby="native-heading">
          <header className={styles.nativeHead}>
            <span className={styles.nativeMark}>
              <CodexMark />
            </span>
            <h3 className={styles.sectionTitle} id="native-heading">
              From Codex
            </h3>
            <span className={styles.readonly}>read-only</span>
          </header>

          {session.plan ? (
            <>
              <ol className={styles.plan}>
                {session.plan.steps.map((step, index) => (
                  <li key={`${index}-${step.step}`} className={styles.step} data-status={step.status}>
                    <span className={styles.stepMark} aria-hidden="true" />
                    <span className={styles.stepText}>{step.step}</span>
                    <span className="visuallyHidden">{step.status.replace('_', ' ')}</span>
                  </li>
                ))}
              </ol>
              <p className={styles.planMeta}>
                Plan revision {session.plan.revision} · updated{' '}
                {formatDuration(elapsedSince(session.plan.updatedAt, now) ?? 0)} ago
              </p>
              {session.plan.explanation ? (
                <p className={styles.explanation}>{session.plan.explanation}</p>
              ) : null}
            </>
          ) : (
            <p className={styles.planMeta}>No plan yet. Codex publishes one when it has scoped the work.</p>
          )}

          {session.planHistory.length > 0 ? (
            <div className={styles.history}>
              <button
                type="button"
                className={styles.historyToggle}
                aria-expanded={showHistory}
                onClick={() => setShowHistory((v) => !v)}
              >
                <Chevron direction={showHistory ? 'down' : 'right'} />
                {session.planHistory.length} earlier plan{' '}
                {session.planHistory.length === 1 ? 'revision' : 'revisions'}
              </button>
              {showHistory ? (
                <ol className={styles.revisions}>
                  {[...session.planHistory].reverse().map((revision) => (
                    <li key={revision.revision} className={styles.revision}>
                      <p className={styles.revisionHead}>
                        Revision {revision.revision} ·{' '}
                        {formatDuration(elapsedSince(revision.updatedAt, now) ?? 0)} ago
                      </p>
                      <ol className={styles.plan}>
                        {revision.steps.map((step, index) => (
                          <li
                            key={`${index}-${step.step}`}
                            className={styles.step}
                            data-status={step.status}
                          >
                            <span className={styles.stepMark} aria-hidden="true" />
                            <span className={styles.stepText}>{step.step}</span>
                          </li>
                        ))}
                      </ol>
                    </li>
                  ))}
                </ol>
              ) : null}
            </div>
          ) : null}

          <dl className={styles.meta}>
            <dt>Model</dt>
            <dd>{session.model}</dd>
            <dt>Repository</dt>
            <dd>{session.repository ?? '—'}</dd>
            <dt>Branch</dt>
            <dd>{session.branch ?? '—'}</dd>
            <dt>Worktree</dt>
            <dd className={styles.mono}>{session.worktree ?? session.cwd}</dd>
            <dt>Thread</dt>
            <dd className={styles.mono}>{session.threadId}</dd>
            <dt>Session age</dt>
            <dd>{age === null ? '—' : formatDuration(age)}</dd>
            <dt>Current turn</dt>
            <dd>{turn === null ? '—' : formatDuration(turn)}</dd>
            {session.parentSessionId ? (
              <>
                <dt>Parent</dt>
                <dd>{session.parentSessionId}</dd>
              </>
            ) : null}
          </dl>
        </section>

        {session.endedAt ? null : (
          <section className={styles.actions} aria-label="Stage">
            <p className={styles.actionsLabel}>Agent Zen stage</p>
            <div className={styles.actionRow}>
              {EVENTS.map((event) => (
                <button
                  key={event.kind}
                  type="button"
                  className={styles.action}
                  onClick={() =>
                    dispatch({
                      type: 'record-event',
                      sessionId: session.id,
                      kind: event.kind,
                      now: Date.now(),
                    })
                  }
                >
                  {event.label}
                </button>
              ))}
            </div>
          </section>
        )}

        <Logbook subjectId={session.id} />
      </div>
    </>
  )
}

function IdeaDetail({ ideaId, onClose }: { ideaId: string; onClose: () => void }) {
  const { state, dispatch, now, projectById } = useAgentZen()
  const [deferred, setDeferred] = useState<string | null>(null)
  const idea = state.ideas.find((i) => i.id === ideaId)
  if (!idea) return null
  const project = projectById(idea.projectId)

  return (
    <>
      <SheetHeader
        title={idea.title}
        subtitle={`Idea · ${project?.name ?? 'No project'}`}
        onClose={onClose}
      />
      <div className={styles.body}>
        {idea.notes ? <p className={styles.notes}>{idea.notes}</p> : null}

        <dl className={styles.meta}>
          <dt>Captured</dt>
          <dd>{formatCaptureTime(idea.createdAt, now)}</dd>
          <dt>Project</dt>
          <dd>{project?.name ?? 'No project'}</dd>
          <dt>Repository</dt>
          <dd>{idea.repository ?? '—'}</dd>
          <dt>Directory</dt>
          <dd className={styles.mono}>{project?.directory ?? '—'}</dd>
        </dl>

        <section className={styles.actions} aria-label="Idea actions">
          <p className={styles.actionsLabel}>Do something with it</p>
          <div className={styles.actionRow}>
            <button
              type="button"
              className={styles.action}
              onClick={() =>
                setDeferred('Launching needs the Codex app-server. Fixture source is read-only.')
              }
            >
              Launch session
            </button>
            <button
              type="button"
              className={styles.action}
              onClick={() =>
                setDeferred('Issue creation needs a GitHub token. Not wired in this prototype.')
              }
            >
              Create GitHub issue
            </button>
            <button
              type="button"
              className={styles.action}
              data-destructive="true"
              onClick={() => {
                dispatch({ type: 'delete-idea', ideaId: idea.id })
                onClose()
              }}
            >
              Delete
            </button>
          </div>
          {deferred ? <p className={styles.deferred}>{deferred}</p> : null}
        </section>

        <Logbook subjectId={idea.id} />
      </div>
    </>
  )
}

function SheetHeader({
  title,
  subtitle,
  onClose,
}: {
  title: string
  subtitle: string
  onClose: () => void
}) {
  return (
    <header className={styles.header}>
      <div className={styles.headerText}>
        <h2 className={styles.headerTitle} id="detail-title">
          {title}
        </h2>
        <p className={styles.headerSub}>{subtitle}</p>
      </div>
      <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
        <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">
          <path
            d="M3.5 3.5l7 7M10.5 3.5l-7 7"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </header>
  )
}
