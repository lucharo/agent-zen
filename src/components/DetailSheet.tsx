import { useState } from 'react'
import { X } from 'lucide-react'
import { deriveStage } from '@/domain/stage'
import { elapsedSince, formatCaptureTime, formatDuration } from '@/domain/time'
import { STAGE_LABELS, type AgentSession } from '@/domain/types'
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
      variant="dialog"
      testId="detail-sheet"
    >
      {session ? <SessionDetail session={session} onClose={onClose} /> : null}
      {idea ? <IdeaDetail ideaId={idea.id} onClose={onClose} /> : null}
    </Overlay>
  )
}

function SessionDetail({ session, onClose }: { session: AgentSession; onClose: () => void }) {
  const { now, projectById, interruptSession, steerSession } = useAgentZen()
  const [showHistory, setShowHistory] = useState(false)
  const [steer, setSteer] = useState('')
  const [controlStatus, setControlStatus] = useState<string | null>(null)
  const [controlling, setControlling] = useState(false)
  const stage = deriveStage(session)
  const project = projectById(session.projectId)
  const age = elapsedSince(session.createdAt, now)
  const turn = session.activity === 'working' ? elapsedSince(session.turnStartedAt, now) : null

  return (
    <>
      <SheetHeader
        title={session.title}
        subtitle={`${stage ? STAGE_LABELS[stage] : 'History'}${session.activity === 'idle' ? ' · Idle' : ''} · ${project?.name ?? 'Outside a Git project'}`}
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
            <span className={styles.readonly}>
              {session.source === 'owned' ? 'Agent Zen-owned' : 'read-only'}
            </span>
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
            <dt>Activity</dt>
            <dd>{session.activity === 'working' ? 'Current turn running' : 'Session open · between turns'}</dd>
            <dt>Model</dt>
            <dd>{session.model}{session.reasoningEffort ? ` · ${session.reasoningEffort}` : ''}</dd>
            <dt>Control</dt>
            <dd>{session.source === 'owned' ? 'Agent Zen' : 'Another Codex process · read-only'}</dd>
            <dt>Repository</dt>
            <dd>{session.repository ?? '—'}</dd>
            <dt>Branch</dt>
            <dd>{session.branch ?? '—'}</dd>
            <dt>Worktree</dt>
            <dd className={styles.mono}>{session.worktree ?? session.cwd}</dd>
            <dt>Thread</dt>
            <dd className={styles.mono}>{session.threadId}</dd>
            <dt>Codex</dt>
            <dd>{session.cliVersion ?? '—'}</dd>
            <dt>Session age</dt>
            <dd>{age === null ? '—' : formatDuration(age)}</dd>
            <dt>Current turn</dt>
            <dd>{turn === null ? 'No turn running' : formatDuration(turn)}</dd>
            {session.parentSessionId ? (
              <>
                <dt>Parent</dt>
                <dd>{session.parentSessionId}</dd>
              </>
            ) : null}
          </dl>
        </section>

        {session.source === 'owned' && session.activity === 'working' ? (
          <section className={styles.controls} aria-labelledby="session-controls-title">
            <div>
              <h3 id="session-controls-title">Current turn</h3>
              <p>Send one instruction or interrupt this Agent Zen-owned turn.</p>
            </div>
            <textarea
              aria-label="Instruction for the current turn"
              placeholder="Add context or redirect the current turn…"
              value={steer}
              onChange={(event) => setSteer(event.target.value)}
            />
            <div className={styles.controlActions}>
              <button
                type="button"
                disabled={!steer.trim() || controlling}
                onClick={() => {
                  setControlling(true)
                  setControlStatus(null)
                  void steerSession(session.threadId, steer).then(
                    () => {
                      setSteer('')
                      setControlling(false)
                      setControlStatus('Instruction sent.')
                    },
                    (error: unknown) => {
                      setControlling(false)
                      setControlStatus(error instanceof Error ? error.message : String(error))
                    },
                  )
                }}
              >
                Send to turn
              </button>
              <button
                type="button"
                data-destructive="true"
                disabled={controlling}
                onClick={() => {
                  setControlling(true)
                  setControlStatus(null)
                  void interruptSession(session.threadId).then(
                    () => {
                      setControlling(false)
                      setControlStatus('Interrupt requested.')
                    },
                    (error: unknown) => {
                      setControlling(false)
                      setControlStatus(error instanceof Error ? error.message : String(error))
                    },
                  )
                }}
              >
                Interrupt
              </button>
            </div>
            {controlStatus ? <p className={styles.controlStatus} role="status">{controlStatus}</p> : null}
          </section>
        ) : null}

        <Logbook subjectId={session.id} />
      </div>
    </>
  )
}

function IdeaDetail({ ideaId, onClose }: { ideaId: string; onClose: () => void }) {
  const { state, dispatch, now, projectById, launchAvailability, activeCount, launchSession } = useAgentZen()
  const [deferred, setDeferred] = useState<string | null>(null)
  const [launching, setLaunching] = useState(false)
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
              disabled={!launchAvailability.allowed || !project || launching}
              onClick={() => {
                if (!project) return
                setLaunching(true)
                setDeferred(null)
                void launchSession(
                  project.id,
                  idea.notes ? `${idea.title}\n\n${idea.notes}` : idea.title,
                ).then(
                  () => {
                    dispatch({ type: 'delete-idea', ideaId: idea.id })
                    onClose()
                  },
                  (error: unknown) => {
                    setLaunching(false)
                    setDeferred(error instanceof Error ? error.message : String(error))
                  },
                )
              }}
            >
              {launching ? 'Launching…' : 'Launch session'}
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
          {!project ? (
            <p className={styles.deferred}>Link this idea to a registered project before launching.</p>
          ) : !launchAvailability.allowed ? (
            <p className={styles.deferred}>
              Focus limit reached: {activeCount} of {state.activeLimit} slots are occupied. Capturing ideas still works.
            </p>
          ) : deferred ? (
            <p className={styles.deferred}>{deferred}</p>
          ) : null}
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
        <X size={14} strokeWidth={1.7} aria-hidden="true" />
      </button>
    </header>
  )
}
