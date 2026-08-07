import { useEffect, useRef, useState } from 'react'
import { useAgentZen } from '@/state/store'
import { Overlay, Select } from './primitives'
import styles from './CaptureSheet.module.css'

export interface CaptureSheetProps {
  open: boolean
  onClose: () => void
  onSaved: (message: string) => void
}

/**
 * Things-style capture: the title takes the caret immediately, Tab walks one
 * compact project field, ⌘M jumps to it, and ⌘↵ saves. Capture remains an
 * Ideas-only action; session control stays on the read-only session surface.
 */
export function CaptureSheet({ open, onClose, onSaved }: CaptureSheetProps) {
  const { state, dispatch } = useAgentZen()
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [projectId, setProjectId] = useState<string | null>(state.projectFilter)
  const titleRef = useRef<HTMLInputElement>(null)
  const projectRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    setTitle('')
    setNotes('')
    setProjectId(state.projectFilter)
    titleRef.current?.focus()
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
        action: 'keep-idea',
      },
      now: Date.now(),
    })
    onSaved('Saved to Ideas')
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
      </div>

      <footer className={styles.footer}>
        <span className={styles.hint}>Tab through fields · ⌘↵ Save</span>
        <button
          type="button"
          className={styles.save}
          onClick={save}
          disabled={!title.trim()}
        >
          Save
        </button>
      </footer>
      </div>
    </Overlay>
  )
}
