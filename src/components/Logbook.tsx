import { useState } from 'react'
import { formatCaptureTime } from '@/domain/time'
import { useAgentZen } from '@/state/store'
import styles from './Logbook.module.css'

/**
 * The human's own margin notes. Deliberately the only writable surface in a
 * detail sheet, deliberately append-only, and deliberately styled unlike
 * everything Codex reports so the two are never confused at a glance.
 */
export function Logbook({ subjectId }: { subjectId: string }) {
  const { dispatch, logbookFor, now } = useAgentZen()
  const [draft, setDraft] = useState('')
  const notes = logbookFor(subjectId)

  const add = () => {
    if (!draft.trim()) return
    dispatch({ type: 'add-logbook-note', subjectId, body: draft, now: Date.now() })
    setDraft('')
  }

  return (
    <section className={styles.logbook} aria-labelledby={`logbook-${subjectId}`}>
      <header className={styles.head}>
        <h3 className={styles.title} id={`logbook-${subjectId}`}>
          Logbook
        </h3>
        <p className={styles.byline}>Yours. Agents never write here.</p>
      </header>

      {notes.length === 0 ? (
        <p className={styles.empty}>No notes yet.</p>
      ) : (
        <ol className={styles.notes}>
          {notes.map((note) => (
            <li key={note.id} className={styles.note}>
              <p className={styles.noteBody}>{note.body}</p>
              <p className={styles.noteTime}>{formatCaptureTime(note.createdAt, now)}</p>
            </li>
          ))}
        </ol>
      )}

      <div className={styles.composer}>
        <textarea
          className={styles.input}
          rows={2}
          placeholder="Add a note…"
          aria-label="New logbook note"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              add()
            }
          }}
        />
        <button type="button" className={styles.add} onClick={add} disabled={!draft.trim()}>
          Add note
        </button>
      </div>
    </section>
  )
}
