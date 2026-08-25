import { useState } from 'react'
import { X } from 'lucide-react'
import { stageReasonLabel, type ClassifiedAgentSession } from '@/domain/stage'
import { elapsedSince, formatCaptureTime, formatDuration } from '@/domain/time'
import {
  STAGE_LABELS,
  type SessionApprovalDecision,
} from '@/domain/types'
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
  onOpenSession: (sessionId: string) => void
}

export function DetailSheet({ target, onClose, onOpenSession }: DetailSheetProps) {
  const { sessions, state } = useAgentZen()

  const session = target?.kind === 'session' ? sessions.find((s) => s.id === target.id) : undefined
  const idea = target?.kind === 'idea' ? state.ideas.find((i) => i.id === target.id) : undefined
  const parent = session?.parentSessionId
    ? sessions.find((candidate) => candidate.id === session.parentSessionId)
    : undefined
  const children = session
    ? sessions.filter((candidate) => candidate.parentSessionId === session.id)
    : []

  return (
    <Overlay
      open={Boolean(session || idea)}
      onClose={onClose}
      labelledBy="detail-title"
      variant="dialog"
      testId="detail-sheet"
    >
      {session ? (
        <SessionDetail
          key={session.id}
          session={session}
          parent={parent}
          children={children}
          onClose={onClose}
          onOpenSession={onOpenSession}
        />
      ) : null}
      {idea ? <IdeaDetail ideaId={idea.id} onClose={onClose} /> : null}
    </Overlay>
  )
}

function SessionDetail({
  session,
  parent,
  children,
  onClose,
  onOpenSession,
}: {
  session: ClassifiedAgentSession
  parent?: ClassifiedAgentSession
  children: readonly ClassifiedAgentSession[]
  onClose: () => void
  onOpenSession: (sessionId: string) => void
}) {
  const { now, projectById, interruptSession, steerSession, respondToSession } = useAgentZen()
  const [showHistory, setShowHistory] = useState(false)
  const [steer, setSteer] = useState('')
  const [controlStatus, setControlStatus] = useState<string | null>(null)
  const [controlling, setControlling] = useState(false)
  const [requestAnswers, setRequestAnswers] = useState<Record<string, string>>({})
  const stage = session.classification.stage
  const project = projectById(session.projectId)
  const age = elapsedSince(session.createdAt, now)
  const turn = session.activity === 'working' || session.activity === 'awaiting-input'
    ? elapsedSince(session.turnStartedAt, now)
    : null

  return (
    <>
      <SheetHeader
        title={session.title}
        subtitle={`${parent ? 'Subagent · ' : ''}${stage ? STAGE_LABELS[stage] : 'History'}${attentionSuffix(session)} · ${project?.name ?? 'Outside a Git project'}`}
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
            <p className={styles.planMeta}>
              {stage === 'planning'
                ? 'Plan mode is active; no plan has been published.'
                : 'No plan published. This turn can still be active.'}
            </p>
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
            <dd>{activityLabel(session)}</dd>
            <dt>Goal</dt>
            <dd>{session.goal ? `${session.goal.status} · ${session.goal.objective}` : '—'}</dd>
            <dt>Stage reason</dt>
            <dd>{stageReasonLabel(session.classification.reason)}</dd>
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
                <dd>
                  {parent ? (
                    <button
                      type="button"
                      className={styles.parentLink}
                      onClick={() => onOpenSession(parent.id)}
                    >
                      {parent.title}
                    </button>
                  ) : session.parentSessionId}
                </dd>
              </>
            ) : null}
          </dl>
        </section>

        {children.length > 0 ? (
          <section className={styles.subagents} aria-labelledby="subagents-heading">
            <header className={styles.subagentsHead}>
              <h3 id="subagents-heading">Subagents</h3>
              <span>{children.length}</span>
            </header>
            <ul className={styles.subagentList}>
              {children.map((child) => (
                <li key={child.id}>
                  <button
                    type="button"
                    className={styles.subagent}
                    onClick={() => onOpenSession(child.id)}
                  >
                    <span className={styles.subagentTitle}>{child.title}</span>
                    <span className={styles.subagentMeta}>
                      {activityLabel(child)} · {child.model}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {session.source === 'owned' && session.pendingRequest ? (
          <section className={styles.controls} aria-labelledby="session-request-title">
            <div>
              <h3 id="session-request-title">Codex needs you</h3>
              <p>Answer the native request to let this turn continue.</p>
            </div>
            {session.pendingRequest.kind === 'user-input' ? (
              <form
                className={styles.requestForm}
                onSubmit={(event) => {
                  event.preventDefault()
                  setControlling(true)
                  setControlStatus(null)
                  const answers = Object.fromEntries(
                    session.pendingRequest?.kind === 'user-input'
                      ? session.pendingRequest.questions.map((question) => [
                          question.id,
                          [requestAnswers[question.id]?.trim() ?? ''].filter(Boolean),
                        ])
                      : [],
                  )
                  void respondToSession(session.threadId, {
                    requestId: session.pendingRequest?.requestId ?? '',
                    kind: 'user-input',
                    answers,
                  }).then(
                    () => {
                      setControlling(false)
                      setRequestAnswers({})
                      setControlStatus('Answer sent.')
                    },
                    (error: unknown) => {
                      setControlling(false)
                      setControlStatus(error instanceof Error ? error.message : String(error))
                    },
                  )
                }}
              >
                {session.pendingRequest.questions.map((question) => (
                  <label key={question.id} className={styles.requestQuestion}>
                    <span>{question.header}</span>
                    <small>{question.question}</small>
                    {question.options && !question.isOther ? (
                      <select
                        aria-label={question.header}
                        value={requestAnswers[question.id] ?? ''}
                        onChange={(event) => setRequestAnswers((answers) => ({
                          ...answers,
                          [question.id]: event.target.value,
                        }))}
                      >
                        <option value="">Choose…</option>
                        {question.options.map((option) => (
                          <option key={option.label} value={option.label}>{option.label}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        aria-label={question.header}
                        type={question.isSecret ? 'password' : 'text'}
                        value={requestAnswers[question.id] ?? ''}
                        onChange={(event) => setRequestAnswers((answers) => ({
                          ...answers,
                          [question.id]: event.target.value,
                        }))}
                      />
                    )}
                  </label>
                ))}
                <div className={styles.controlActions}>
                  <button
                    type="submit"
                    disabled={controlling || session.pendingRequest.questions.some(
                      (question) => !requestAnswers[question.id]?.trim(),
                    )}
                  >
                    Send answer
                  </button>
                  <InterruptButton
                    controlling={controlling}
                    onInterrupt={() => runInterrupt(
                      session.threadId,
                      interruptSession,
                      setControlling,
                      setControlStatus,
                    )}
                  />
                </div>
              </form>
            ) : session.pendingRequest.kind === 'approval' ? (
              <div className={styles.requestForm}>
                <div className={styles.approvalCopy}>
                  <strong>{session.pendingRequest.title}</strong>
                  {session.pendingRequest.detail ? <code>{session.pendingRequest.detail}</code> : null}
                  {session.pendingRequest.reason ? <p>{session.pendingRequest.reason}</p> : null}
                </div>
                <div className={styles.controlActions}>
                  {session.pendingRequest.availableDecisions.map((decision) => (
                    <button
                      key={decision}
                      type="button"
                      data-destructive={decision === 'decline' || decision === 'cancel' ? 'true' : undefined}
                      disabled={controlling}
                      onClick={() => {
                        setControlling(true)
                        setControlStatus(null)
                        void respondToSession(session.threadId, {
                          requestId: session.pendingRequest?.requestId ?? '',
                          kind: 'approval',
                          decision,
                        }).then(
                          () => {
                            setControlling(false)
                            setControlStatus('Decision sent.')
                          },
                          (error: unknown) => {
                            setControlling(false)
                            setControlStatus(error instanceof Error ? error.message : String(error))
                          },
                        )
                      }}
                    >
                      {approvalLabel(decision)}
                    </button>
                  ))}
                  <InterruptButton
                    controlling={controlling}
                    onInterrupt={() => runInterrupt(
                      session.threadId,
                      interruptSession,
                      setControlling,
                      setControlStatus,
                    )}
                  />
                </div>
              </div>
            ) : session.pendingRequest.kind === 'permissions' ? (
              <div className={styles.requestForm}>
                <div className={styles.approvalCopy}>
                  <strong>{session.pendingRequest.title}</strong>
                  {session.pendingRequest.reason ? <p>{session.pendingRequest.reason}</p> : null}
                  <code>{permissionSummary(session.pendingRequest.requestedPermissions)}</code>
                </div>
                <div className={styles.controlActions}>
                  {(['turn', 'session'] as const).map((scope) => (
                    <button
                      key={scope}
                      type="button"
                      disabled={controlling}
                      onClick={() => {
                        setControlling(true)
                        setControlStatus(null)
                        void respondToSession(session.threadId, {
                          requestId: session.pendingRequest?.requestId ?? '',
                          kind: 'permissions',
                          scope,
                        }).then(
                          () => {
                            setControlling(false)
                            setControlStatus('Permissions granted.')
                          },
                          (error: unknown) => {
                            setControlling(false)
                            setControlStatus(error instanceof Error ? error.message : String(error))
                          },
                        )
                      }}
                    >
                      {scope === 'turn' ? 'Grant once' : 'Grant for session'}
                    </button>
                  ))}
                  <InterruptButton
                    controlling={controlling}
                    onInterrupt={() => runInterrupt(
                      session.threadId,
                      interruptSession,
                      setControlling,
                      setControlStatus,
                    )}
                  />
                </div>
              </div>
            ) : (
              <div className={styles.requestForm}>
                <p>{session.pendingRequest.title}</p>
                {session.pendingRequest.detail ? <code>{session.pendingRequest.detail}</code> : null}
                <div className={styles.controlActions}>
                  <InterruptButton
                    controlling={controlling}
                    onInterrupt={() => runInterrupt(
                      session.threadId,
                      interruptSession,
                      setControlling,
                      setControlStatus,
                    )}
                  />
                </div>
              </div>
            )}
            {controlStatus ? <p className={styles.controlStatus} role="status">{controlStatus}</p> : null}
          </section>
        ) : session.source === 'owned' && (
          session.activity === 'working' || session.activity === 'awaiting-input'
        ) ? (
          <section className={styles.controls} aria-labelledby="session-controls-title">
            <div>
              <h3 id="session-controls-title">Current turn</h3>
              <p>
                {session.activity === 'working'
                  ? 'Send one instruction or interrupt this Agent Zen-owned turn.'
                  : 'This turn needs input in Codex. You can still interrupt it here.'}
              </p>
            </div>
            {session.activity === 'working' ? (
              <textarea
                aria-label="Instruction for the current turn"
                placeholder="Add context or redirect the current turn…"
                value={steer}
                onChange={(event) => setSteer(event.target.value)}
              />
            ) : null}
            <div className={styles.controlActions}>
              {session.activity === 'working' ? (
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
              ) : null}
              <InterruptButton
                controlling={controlling}
                onInterrupt={() => runInterrupt(
                  session.threadId,
                  interruptSession,
                  setControlling,
                  setControlStatus,
                )}
              />
            </div>
            {controlStatus ? <p className={styles.controlStatus} role="status">{controlStatus}</p> : null}
          </section>
        ) : null}

        <Logbook subjectId={session.id} />
      </div>
    </>
  )
}

function InterruptButton({ controlling, onInterrupt }: {
  controlling: boolean
  onInterrupt: () => void
}) {
  return (
    <button
      type="button"
      data-destructive="true"
      disabled={controlling}
      onClick={onInterrupt}
    >
      Interrupt
    </button>
  )
}

function runInterrupt(
  threadId: string,
  interruptSession: (threadId: string) => Promise<void>,
  setControlling: (value: boolean) => void,
  setControlStatus: (value: string | null) => void,
): void {
  setControlling(true)
  setControlStatus(null)
  void interruptSession(threadId).then(
    () => {
      setControlling(false)
      setControlStatus('Interrupt requested.')
    },
    (error: unknown) => {
      setControlling(false)
      setControlStatus(error instanceof Error ? error.message : String(error))
    },
  )
}

function approvalLabel(decision: SessionApprovalDecision): string {
  if (decision === 'accept') return 'Approve once'
  if (decision === 'acceptForSession') return 'Approve for session'
  if (decision === 'decline') return 'Decline'
  return 'Cancel turn'
}

function permissionSummary(requested: Readonly<Record<string, unknown>>): string {
  const fileSystem = requested.fileSystem
  const network = requested.network
  const parts: string[] = []
  if (fileSystem && typeof fileSystem === 'object' && !Array.isArray(fileSystem)) {
    const files = fileSystem as Record<string, unknown>
    const reads = Array.isArray(files.read) ? files.read.filter((value) => typeof value === 'string') : []
    const writes = Array.isArray(files.write) ? files.write.filter((value) => typeof value === 'string') : []
    if (reads.length > 0) parts.push(`Read: ${reads.join(', ')}`)
    if (writes.length > 0) parts.push(`Write: ${writes.join(', ')}`)
  }
  if (network && typeof network === 'object' && !Array.isArray(network)) {
    if ((network as Record<string, unknown>).enabled === true) parts.push('Network access')
  }
  return parts.join('\n') || 'Additional Codex permissions'
}

function attentionSuffix(session: ClassifiedAgentSession): string {
  if (session.classification.needsUser) return ' · Needs you'
  if (session.activity === 'working') return ' · Working'
  if (session.activity === 'idle') return ' · Idle'
  return ''
}

function activityLabel(session: ClassifiedAgentSession): string {
  if (session.classification.needsUser) return 'Needs your attention'
  if (session.activity === 'working') return 'Working on current turn'
  if (session.activity === 'idle') return 'Between turns'
  return 'Ended'
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
