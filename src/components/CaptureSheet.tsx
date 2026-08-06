import { useEffect, useRef, useState } from 'react'
import type { CaptureAction } from '@/domain/types'
import { useAgentZen } from '@/state/store'
import { Overlay, Select } from './primitives'
import styles from './CaptureSheet.module.css'

const ACTIONS: ReadonlyArray<{ value: CaptureAction; label: string }> = [
  { value: 'keep-idea', label: 'Keep as idea' },
  { value: 'github-issue', label: 'Draft GitHub issue' },
  { value: 'launch-session', label: 'Launch session' },
]

export interface CaptureSheetProps {
  open: boolean
  onClose: () => void
  onSaved: (message: string) => void
}

/**
 * Things-style capture: the title takes the caret immediately, Tab walks one
 * compact row of quick fields, ⌘M jumps to the project, ⌘↵ saves. Nothing
 * launches by default — the action field starts on `Keep as idea`.
 */
export function CaptureSheet({ open, onClose, onSaved }: CaptureSheetProps) {
  const { state, dispatch, launchAvailability, launchSession } = useAgentZen()
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [projectId, setProjectId] = useState<string | null>(state.projectFilter)
  const [action, setAction] = useState<CaptureAction>('keep-idea')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const projectRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    setTitle('')
    setNotes('')
    setProjectId(state.projectFilter)
    setAction('keep-idea')
    setSaving(false)
    setError(null)
    titleRef.current?.focus()
    // Reset once per opening, deliberately not on every filter change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open) return null

  const project = state.projects.find((p) => p.id === projectId) ?? null

  const save = async () => {
    if (!title.trim()) return
    setSaving(true)
    setError(null)
    if (action === 'launch-session') {
      if (!projectId) {
        setSaving(false)
        setError('Choose a project before launching a Codex session.')
        return
      }
      try {
        await launchSession(projectId, notes.trim() ? `${title.trim()}\n\n${notes.trim()}` : title.trim())
        onSaved('Session launched')
        onClose()
      } catch (launchError) {
        setSaving(false)
        setError(launchError instanceof Error ? launchError.message : String(launchError))
      }
      return
    }
    dispatch({
      type: 'capture-idea',
      draft: {
        title,
        notes,
        projectId,
        repository: project?.repository ?? null,
        action,
      },
      now: Date.now(),
    })
    onSaved(action === 'github-issue' ? 'Issue draft saved to Ideas' : 'Saved to Ideas')
    onClose()
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      onClose()
      return
    }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      void save()
      return
    }
    if (event.key.toLowerCase() === 'm' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      projectRef.current?.querySelector('select')?.focus()
    }
  }

  const launchBlocked = action === 'launch-session' && (!projectId || !launchAvailability.allowed)

  return (
    <Overlay
      open={open}
      onClose={onClose}
      labelledBy="capture-title"
      variant="dialog"
      testId="capture-sheet"
    >
      <div className={styles.sheet} onKeyDown={onKeyDown}>
      <h2 id="capture-title" className="visuallyHidden">Quick capture</h2>
      <input
        ref={titleRef}
        data-autofocus
        className={styles.title}
        placeholder="Capture an idea…"
        aria-label="Title"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
      />
      <input
        className={styles.notes}
        placeholder="Notes"
        aria-label="Notes"
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
      />

      <div className={styles.fields}>
        <div className={styles.field} ref={projectRef}>
          <Select
            label="Project"
            hint="⌘M"
            block
            value={projectId ?? 'none'}
            onChange={(value) => setProjectId(value === 'none' ? null : value)}
            options={[
              { value: 'none', label: 'No project' },
              ...state.projects.map((p) => ({ value: p.id, label: p.name })),
            ]}
          />
        </div>
        <p className={styles.repo} aria-label="Repository">
          <span className={styles.repoLabel}>Repository</span>
          <span className={styles.repoValue}>{project?.repository ?? '—'}</span>
        </p>
        <div className={styles.field}>
          <Select
            label="Action"
            block
            value={action}
            onChange={(value) => setAction(value as CaptureAction)}
            options={ACTIONS}
          />
        </div>
      </div>

      <footer className={styles.footer}>
        <span className={styles.hint}>Tab through fields · ⌘↵ {action === 'launch-session' ? 'Launch' : 'Save'}</span>
        <button
          type="button"
          className={styles.save}
          onClick={() => void save()}
          disabled={!title.trim() || launchBlocked || saving}
        >
          {saving ? 'Working…' : action === 'launch-session' ? 'Launch' : 'Save'}
        </button>
      </footer>
      {launchBlocked && projectId && !launchAvailability.allowed ? (
        <p className={styles.error}>Focus limit reached. Capture still works; a new root session does not.</p>
      ) : error ? <p className={styles.error} role="alert">{error}</p> : null}
      </div>
    </Overlay>
  )
}
