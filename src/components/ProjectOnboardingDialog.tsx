import { useEffect, useMemo, useState } from 'react'
import { useAgentZen } from '@/state/store'
import { SearchIcon, Overlay } from './primitives'
import styles from './ProjectOnboardingDialog.module.css'

export interface ProjectOnboardingDialogProps {
  open: boolean
  onClose: () => void
}

export function ProjectOnboardingDialog({ open, onClose }: ProjectOnboardingDialogProps) {
  const { state, dispatch, projectCandidates, projectSourceLabel, projectSourceMode } = useAgentZen()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())

  useEffect(() => {
    if (!open) return
    setQuery('')
    setSelected(new Set())
  }, [open])

  const registered = useMemo(
    () => new Set(state.projects.flatMap((project) => [project.directory, project.repository])),
    [state.projects],
  )
  const available = projectCandidates.filter(
    (project) => !registered.has(project.directory) && !registered.has(project.repository),
  )
  const needle = query.trim().toLowerCase()
  const visible = needle
    ? available.filter((project) =>
        [project.name, project.directory, project.repository]
          .filter(Boolean)
          .some((value) => value?.toLowerCase().includes(needle)),
      )
    : available

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const register = () => {
    dispatch({
      type: 'add-projects',
      projects: available.filter((project) => selected.has(project.id)),
    })
    onClose()
  }

  return (
    <Overlay
      open={open}
      onClose={onClose}
      labelledBy="project-onboarding-title"
      variant="dialog"
      testId="project-onboarding-dialog"
    >
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>PROJECTS</p>
          <h2 id="project-onboarding-title">Choose the repositories you work in</h2>
          <p>Start small. Agent Zen uses the local checkout to match Codex sessions and keeps the GitHub link beside it.</p>
        </div>
        <button type="button" className={styles.close} onClick={onClose} aria-label="Close project setup">
          ×
        </button>
      </header>

      <div className={styles.body}>
        <div className={styles.sourceRow}>
          <span>{projectSourceLabel}</span>
          <span data-mode={projectSourceMode}>{projectSourceMode === 'fixture' ? 'Sample discovery' : 'Local discovery'}</span>
        </div>

        <label className={styles.search}>
          <SearchIcon />
          <input
            data-autofocus
            aria-label="Filter projects"
            placeholder="Repository or local path"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>

        <ul className={styles.list} aria-label="Discovered projects">
          {visible.map((project) => (
            <li key={project.id}>
              <label className={styles.row} data-selected={selected.has(project.id)}>
                <input
                  type="checkbox"
                  checked={selected.has(project.id)}
                  onChange={() => toggle(project.id)}
                />
                <span className={styles.check} aria-hidden="true" />
                <span className={styles.copy}>
                  <strong>{project.repository ?? project.name}</strong>
                  <span>{project.directory}</span>
                </span>
                <span className={styles.branch}>{project.defaultBranch ?? 'No default branch'}</span>
              </label>
            </li>
          ))}
          {visible.length === 0 ? (
            <li className={styles.empty}>
              {available.length === 0 ? 'Every discovered project is already registered.' : 'No projects match.'}
            </li>
          ) : null}
        </ul>
      </div>

      <footer className={styles.footer}>
        <span>{selected.size} selected</span>
        <div>
          <button type="button" className={styles.cancel} onClick={onClose}>Cancel</button>
          <button type="button" className={styles.register} disabled={selected.size === 0} onClick={register}>
            Register {selected.size || ''} {selected.size === 1 ? 'project' : 'projects'}
          </button>
        </div>
      </footer>
    </Overlay>
  )
}
