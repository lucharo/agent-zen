import { useEffect, useRef, useState } from 'react'
import type { CaptureAction } from '@/domain/types'
import { useAgentZen } from '@/state/store'
import { Select } from './primitives'
import styles from './CaptureSheet.module.css'

const ACTIONS: ReadonlyArray<{ value: CaptureAction; label: string }> = [
  { value: 'keep-idea', label: 'Keep as idea' },
  { value: 'github-issue', label: 'Create GitHub issue' },
  { value: 'launch-session', label: 'Launch session' },
]

export interface CaptureSheetProps {
  open: boolean
  onClose: () => void
}

/**
 * Things-style capture: the title takes the caret immediately, Tab walks one
 * compact row of quick fields, ⌘M jumps to the project, ⌘↵ saves. Nothing
 * launches by default — the action field starts on `Keep as idea`.
 */
export function CaptureSheet({ open, onClose }: CaptureSheetProps) {
  const { state, dispatch } = useAgentZen()
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [projectId, setProjectId] = useState<string | null>(state.projectFilter)
  const [action, setAction] = useState<CaptureAction>('keep-idea')
  const titleRef = useRef<HTMLInputElement>(null)
  const projectRef = useRef<HTMLDivElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  const returnTo = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    returnTo.current = document.activeElement as HTMLElement | null
    setTitle('')
    setNotes('')
    setProjectId(state.projectFilter)
    setAction('keep-idea')
    titleRef.current?.focus()
    return () => returnTo.current?.focus?.()
    // Reset once per opening, deliberately not on every filter change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open) return null

  const project = state.projects.find((p) => p.id === projectId) ?? null

  const save = () => {
    if (!title.trim()) return
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
      save()
      return
    }
    if (event.key.toLowerCase() === 'm' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      projectRef.current?.querySelector('select')?.focus()
    }
  }

  return (
    <div
      className={styles.sheet}
      ref={sheetRef}
      role="dialog"
      aria-label="Quick capture"
      data-testid="capture-sheet"
      onKeyDown={onKeyDown}
    >
      <input
        ref={titleRef}
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
        <span className={styles.hint}>Tab through fields · ⌘↵ Save</span>
        <button type="button" className={styles.save} onClick={save} disabled={!title.trim()}>
          Save
        </button>
      </footer>
    </div>
  )
}
