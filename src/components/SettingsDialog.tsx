import { Eye, Focus, FolderGit2, Link2, X } from 'lucide-react'
import { useAgentZen } from '@/state/store'
import { AgentMark, Overlay } from './primitives'
import { AGENT_LABELS } from '@/domain/types'
import styles from './SettingsDialog.module.css'

export interface SettingsDialogProps {
  open: boolean
  onClose: () => void
  onAddProjects: () => void
}

export function SettingsDialog({ open, onClose, onAddProjects }: SettingsDialogProps) {
  const { state, dispatch, activeCount, sourceMode, sourceLabel, connectionError, backends, setFocus } = useAgentZen()

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
          <X size={16} strokeWidth={1.7} aria-hidden="true" />
        </button>
      </header>

      <div className={styles.body}>
        <section className={styles.section} aria-labelledby="connection-heading">
          <div className={styles.sectionHead}>
            <span className={styles.sectionIcon} data-tone="codex"><SettingsIcon kind="connection" /></span>
            <div className={styles.sectionCopy}>
              <h3 id="connection-heading">Connections</h3>
              <p>Codex sessions launched here are controllable. Everything else, including every Claude Code session, stays read-only.</p>
            </div>
            <span className={styles.status} data-mode={sourceMode}>
              {sourceLabel}
            </span>
          </div>
          {connectionError ? (
            <p className={styles.notice}>{connectionError}</p>
          ) : sourceMode === 'fixture' ? (
            <p className={styles.notice}>
              The local bridge is unavailable, so Agent Zen is showing sample sessions until it reconnects.
            </p>
          ) : null}
          {backends.length > 0 ? (
            <ul className={styles.backendList} aria-label="Agent connections">
              {backends.map((backend) => (
                <li key={backend.agent} className={styles.backendRow} data-connected={backend.connected}>
                  <AgentMark agent={backend.agent} title="" />
                  <span>{AGENT_LABELS[backend.agent]}</span>
                  <span className={styles.backendState}>
                    {backend.connected ? backend.userAgent ?? 'connected' : backend.error ?? 'unavailable'}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        <section className={styles.section} aria-labelledby="appearance-heading">
          <div className={styles.sectionHead}>
            <span className={styles.sectionIcon} data-tone="appearance"><SettingsIcon kind="appearance" /></span>
            <div className={styles.sectionCopy}>
              <h3 id="appearance-heading">Board appearance</h3>
              <p>Choose how collapsed lanes and attention states appear.</p>
            </div>
          </div>
          <div className={styles.preferenceRows}>
            <PreferenceSwitch
              label="Show collapsed lanes"
              description="Keep collapsed and empty lanes visible as narrow tabs."
              checked={state.showCollapsedLanes}
              onChange={(value) => dispatch({ type: 'set-show-collapsed-lanes', value })}
            />
            <PreferenceSwitch
              label="Highlight Needs you"
              description="Tint the whole Needs you lane yellow."
              checked={state.highlightNeedsYou}
              onChange={(value) => dispatch({ type: 'set-highlight-needs-you', value })}
            />
            <PreferenceSwitch
              label="Constrain column width"
              description="Keep boards centred and columns at a readable width."
              checked={state.constrainBoardWidth}
              onChange={(value) => dispatch({ type: 'set-constrain-board-width', value })}
            />
          </div>
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

function PreferenceSwitch({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <div className={styles.preferenceRow}>
      <div><strong>{label}</strong><span>{description}</span></div>
      <button
        type="button"
        className={styles.toggle}
        role="switch"
        aria-label={label}
        aria-checked={checked}
        onClick={() => onChange(!checked)}
      >
        <span className={styles.toggleThumb} />
      </button>
    </div>
  )
}

function SettingsIcon({ kind }: { kind: 'connection' | 'focus' | 'projects' | 'appearance' }) {
  const Icon = kind === 'connection' ? Link2 : kind === 'focus' ? Focus : kind === 'appearance' ? Eye : FolderGit2
  return <Icon size={20} strokeWidth={1.6} aria-hidden="true" />
}
