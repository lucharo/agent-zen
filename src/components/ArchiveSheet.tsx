import { formatCaptureTime } from '@/domain/time'
import { useAgentZen } from '@/state/store'
import { Overlay } from './primitives'
import styles from './ArchiveSheet.module.css'

export interface ArchiveSheetProps {
  open: boolean
  onClose: () => void
  onOpenSession: (sessionId: string) => void
}

/**
 * Where finished work goes instead of a Done column: quiet, out of the focus
 * surface, one click away.
 */
export function ArchiveSheet({ open, onClose, onOpenSession }: ArchiveSheetProps) {
  const { archived, now, projectById } = useAgentZen()

  return (
    <Overlay
      open={open}
      onClose={onClose}
      labelledBy="archive-title"
      variant="sheet"
      testId="archive-sheet"
    >
      <header className={styles.header}>
        <div>
          <h2 className={styles.title} id="archive-title">
            History
          </h2>
          <p className={styles.sub}>Finished threads, kept out of the way.</p>
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

      <div className={styles.body}>
        {archived.length === 0 ? (
          <p className={styles.empty}>Nothing finished yet.</p>
        ) : (
          <ul className={styles.list}>
            {archived.map((session) => (
              <li key={session.id}>
                <button
                  type="button"
                  className={styles.row}
                  onClick={() => onOpenSession(session.id)}
                >
                  <span className={styles.rowTitle}>{session.title}</span>
                  <span className={styles.rowMeta}>
                    {projectById(session.projectId)?.name ?? 'No project'} ·{' '}
                    {session.endedAt ? formatCaptureTime(session.endedAt, now) : '—'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Overlay>
  )
}
