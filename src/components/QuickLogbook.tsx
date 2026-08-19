import { useState, type FormEvent } from 'react'
import { useAgentZen } from '@/state/store'
import styles from './QuickLogbook.module.css'

export interface QuickLogbookProps {
  subjectId: string
  subjectLabel: string
}

export function QuickLogbook({ subjectId, subjectLabel }: QuickLogbookProps) {
  const { dispatch } = useAgentZen()
  const [draft, setDraft] = useState('')

  const append = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!draft.trim()) return
    dispatch({ type: 'add-logbook-note', subjectId, body: draft, now: Date.now() })
    setDraft('')
  }

  return (
    <form className={styles.form} onSubmit={append}>
      <input
        className={styles.input}
        type="text"
        autoComplete="off"
        aria-label={`Quick logbook entry for ${subjectLabel}`}
        placeholder="Quick logbook entry…"
        title="Press Enter to append"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
    </form>
  )
}
