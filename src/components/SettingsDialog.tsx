import { useAgentZen } from '@/state/store'
import { Overlay } from './primitives'
import styles from './SettingsDialog.module.css'

export interface SettingsDialogProps {
  open: boolean
  onClose: () => void
  onAddProjects: () => void
}

export function SettingsDialog({ open, onClose, onAddProjects }: SettingsDialogProps) {
  const { state, activeCount, sourceMode, sourceLabel, connectionError, setFocus } = useAgentZen()

  return (
    <Overlay
      open={open}
      onClose={onClose}
      labelledBy="settings-title"
      variant="dialog"
      testId="settings-dialog"
    >
      <header className={styles.header}>
        <div>
          <h2 id="settings-title">Settings</h2>
          <p>Local by default. Read-only unless you launch here.</p>
        </div>
        <button type="button" className={styles.close} onClick={onClose} aria-label="Close settings">
          ×
        </button>
      </header>

      <div className={styles.body}>
        <section className={styles.section} aria-labelledby="connection-heading">
          <div className={styles.sectionHead}>
            <span className={styles.sectionIcon} data-tone="codex"><SettingsIcon kind="connection" /></span>
            <div className={styles.sectionCopy}>
              <h3 id="connection-heading">Codex connection</h3>
              <p>Owned sessions are controllable. Other Codex sessions stay read-only.</p>
            </div>
            <span className={styles.status} data-mode={sourceMode}>
              {sourceLabel}
            </span>
          </div>
          {connectionError ? (
            <p className={styles.notice} role="alert">{connectionError}</p>
          ) : sourceMode === 'fixture' ? (
            <p className={styles.notice}>
              The local bridge is unavailable, so Agent Zen is showing sample sessions until it reconnects.
            </p>
          ) : null}
        </section>

        <section className={styles.section} aria-labelledby="limit-heading">
          <div className={styles.sectionHead}>
            <span className={styles.sectionIcon} data-tone="focus"><SettingsIcon kind="focus" /></span>
            <div className={styles.sectionCopy}>
              <h3 id="limit-heading">Focus</h3>
              <p>Optionally cap new root sessions launched from Agent Zen.</p>
            </div>
            <button
              type="button"
              className={styles.toggle}
              role="switch"
              aria-checked={state.activeLimitEnabled}
              onClick={() => void setFocus(!state.activeLimitEnabled, state.activeLimit)}
            >
              <span className={styles.toggleThumb} />
              <span className="visuallyHidden">
                {state.activeLimitEnabled ? 'Disable focus limit' : 'Enable focus limit'}
              </span>
            </button>
          </div>

          <div className={styles.limitRow} data-disabled={!state.activeLimitEnabled}>
            <span>
              {state.activeLimitEnabled
                ? `${activeCount} of ${state.activeLimit} slots occupied`
                : `${activeCount} sessions active · limit off`}
            </span>
            <div className={styles.limitStepper} aria-label="Active session limit">
              <button
                type="button"
                aria-label="Lower active session limit"
                disabled={!state.activeLimitEnabled || state.activeLimit <= 1}
                onClick={() => void setFocus(true, state.activeLimit - 1)}
              >
                −
              </button>
              <output aria-label="Active session limit value">{state.activeLimit}</output>
              <button
                type="button"
                aria-label="Raise active session limit"
                disabled={!state.activeLimitEnabled || state.activeLimit >= 9}
                onClick={() => void setFocus(true, state.activeLimit + 1)}
              >
                +
              </button>
            </div>
          </div>
          <p className={styles.footnote}>
            Blocks only new Agent Zen roots. Children share a slot; review and wrapup free it. Existing sessions keep running.
          </p>
        </section>

        <section className={styles.section} aria-labelledby="projects-heading">
          <div className={styles.sectionHead}>
            <span className={styles.sectionIcon} data-tone="projects"><SettingsIcon kind="projects" /></span>
            <div className={styles.sectionCopy}>
              <h3 id="projects-heading">Projects</h3>
              <p>Active Git repositories register themselves. Add others as launch targets.</p>
            </div>
            <button type="button" className={styles.addProjects} onClick={onAddProjects}>
              Add projects…
            </button>
          </div>
          <ul className={styles.projects}>
            {state.projects.map((project) => (
              <li key={project.id}>
                <div>
                  <strong>{project.name}</strong>
                  <span>{project.directory}</span>
                </div>
                <span>{project.repository ?? 'Local only'}</span>
              </li>
            ))}
            {state.projects.length === 0 ? (
              <li>
                <div>
                  <strong>No Git projects observed yet</strong>
                  <span>Start a Codex session in a repository or add one manually.</span>
                </div>
              </li>
            ) : null}
          </ul>
        </section>
      </div>
    </Overlay>
  )
}

function SettingsIcon({ kind }: { kind: 'connection' | 'focus' | 'projects' }) {
  return (
    <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      {kind === 'connection' ? (
        <>
          <path d="M6.4 6.5 4.8 8.1a3 3 0 0 0 4.2 4.2l1.7-1.7M13.6 13.5l1.6-1.6A3 3 0 0 0 11 7.7L9.3 9.4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </>
      ) : kind === 'focus' ? (
        <>
          <circle cx="10" cy="10" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="10" cy="10" r="2.2" fill="currentColor" />
        </>
      ) : (
        <>
          <path d="M3.5 6.2h5l1.5 1.6h6.5v7.1H3.5Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M3.5 6.2V4.8h5.2l1.2 1.4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        </>
      )}
    </svg>
  )
}
