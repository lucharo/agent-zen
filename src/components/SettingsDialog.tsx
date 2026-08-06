import { useAgentZen } from '@/state/store'
import { Overlay } from './primitives'
import styles from './SettingsDialog.module.css'

export interface SettingsDialogProps {
  open: boolean
  onClose: () => void
  onAddProjects: () => void
}

export function SettingsDialog({ open, onClose, onAddProjects }: SettingsDialogProps) {
  const { state, dispatch, activeCount, sourceMode, sourceLabel } = useAgentZen()

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
          <p>Agent Zen stays local and reads Codex without asking it to maintain another board.</p>
        </div>
        <button type="button" className={styles.close} onClick={onClose} aria-label="Close settings">
          ×
        </button>
      </header>

      <div className={styles.body}>
        <section className={styles.section} aria-labelledby="connection-heading">
          <div className={styles.sectionHead}>
            <div>
              <h3 id="connection-heading">Codex connection</h3>
              <p>Bundled app-server for control; read-only rollout observation for other processes.</p>
            </div>
            <span className={styles.status} data-mode={sourceMode}>
              {sourceLabel}
            </span>
          </div>
          {sourceMode === 'fixture' ? (
            <p className={styles.notice}>
              This build is using sample sessions. Hooks and ACP are not required for the planned live connection.
            </p>
          ) : null}
        </section>

        <section className={styles.section} aria-labelledby="limit-heading">
          <div className={styles.sectionHead}>
            <div>
              <h3 id="limit-heading">Focus limit</h3>
              <p>When enabled, refuse only new root-session launches after every slot is occupied.</p>
            </div>
            <button
              type="button"
              className={styles.toggle}
              role="switch"
              aria-checked={state.activeLimitEnabled}
              onClick={() =>
                dispatch({
                  type: 'set-active-limit-enabled',
                  enabled: !state.activeLimitEnabled,
                })
              }
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
                onClick={() =>
                  dispatch({ type: 'set-active-limit', limit: state.activeLimit - 1 })
                }
              >
                −
              </button>
              <output aria-label="Active session limit value">{state.activeLimit}</output>
              <button
                type="button"
                aria-label="Raise active session limit"
                disabled={!state.activeLimitEnabled || state.activeLimit >= 9}
                onClick={() =>
                  dispatch({ type: 'set-active-limit', limit: state.activeLimit + 1 })
                }
              >
                +
              </button>
            </div>
          </div>
          <p className={styles.footnote}>
            Child agents share their parent’s slot. Reviewing and Wrapping up release capacity. Existing sessions are never stopped.
          </p>
        </section>

        <section className={styles.section} aria-labelledby="projects-heading">
          <div className={styles.sectionHead}>
            <div>
              <h3 id="projects-heading">Projects</h3>
              <p>Local checkouts provide identity; the GitHub repository is linked when detected.</p>
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
          </ul>
        </section>
      </div>
    </Overlay>
  )
}
