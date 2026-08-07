import { useCallback, useEffect, useState } from 'react'
import { CircleAlert } from 'lucide-react'
import { filterIdeas } from '@/domain/ideas'
import { CAPTURE_SHORTCUT } from '@/keyboard'
import { useAgentZen } from '@/state/store'
import { CaptureSheet } from '@/components/CaptureSheet'
import { CommandPalette } from '@/components/CommandPalette'
import { DetailSheet, type DetailTarget } from '@/components/DetailSheet'
import { IdeasView } from '@/components/IdeasView'
import { KanbanView } from '@/components/KanbanView'
import { SessionGridView } from '@/components/SessionGridView'
import { ProjectOnboardingDialog } from '@/components/ProjectOnboardingDialog'
import { SettingsDialog } from '@/components/SettingsDialog'
import { Toolbar } from '@/components/Toolbar'
import styles from './App.module.css'

export function App() {
  const { state, dispatch, sourceReady, connectionError } = useAgentZen()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [captureOpen, setCaptureOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [projectOnboardingOpen, setProjectOnboardingOpen] = useState(false)
  const [shortcutHints, setShortcutHints] = useState(false)
  const [detail, setDetail] = useState<DetailTarget>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const modalOpen = paletteOpen || captureOpen || settingsOpen || projectOnboardingOpen || detail !== null

  const ideas = filterIdeas(state.ideas, { projectId: state.projectFilter })

  const openSession = useCallback((id: string) => {
    setDetail({ kind: 'session', id })
  }, [])
  const openIdea = useCallback((id: string) => setDetail({ kind: 'idea', id }), [])
  const openCapture = useCallback(() => setCaptureOpen(true), [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey
      const key = event.key.toLowerCase()

      if (event.key === 'Meta' || event.key === 'Control') setShortcutHints(true)
      if (modalOpen && event.key !== 'Escape') return

      if (meta && key === 'k') {
        event.preventDefault()
        setPaletteOpen(true)
        return
      }
      if (!meta && !event.altKey && key === CAPTURE_SHORTCUT.toLowerCase() && !isEditable(event.target)) {
        event.preventDefault()
        setCaptureOpen(true)
        return
      }
      if (meta && event.key === ',') {
        event.preventDefault()
        setSettingsOpen(true)
        return
      }
      if (meta && (key === '1' || key === '2')) {
        event.preventDefault()
        dispatch({ type: 'set-view', view: key === '1' ? 'kanban' : 'ideas' })
        return
      }
      if (event.key === 'Escape') {
        setPaletteOpen(false)
        setCaptureOpen(false)
        setSettingsOpen(false)
        setProjectOnboardingOpen(false)
        setDetail(null)
      }
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Meta' || event.key === 'Control') setShortcutHints(false)
    }
    const onBlur = () => setShortcutHints(false)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [dispatch, modalOpen])

  useEffect(() => {
    const openNewIdea = () => {
      if (!modalOpen) setCaptureOpen(true)
    }
    const openSettings = () => {
      if (!modalOpen) setSettingsOpen(true)
    }
    window.addEventListener('agent-zen:new-idea', openNewIdea)
    window.addEventListener('agent-zen:settings', openSettings)
    return () => {
      window.removeEventListener('agent-zen:new-idea', openNewIdea)
      window.removeEventListener('agent-zen:settings', openSettings)
    }
  }, [modalOpen])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 2600)
    return () => window.clearTimeout(timer)
  }, [notice])

  if (!sourceReady) {
    return (
      <div className={styles.app}>
        <div className={styles.connecting} role="status" aria-live="polite">
          <span className="codexMark" aria-hidden="true" />
          <div>
            <strong>Connecting to Codex</strong>
            <p>Reading local sessions and plans…</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.app}>
      <Toolbar
        ideaCount={ideas.length}
        onOpenPalette={() => setPaletteOpen(true)}
        onOpenCapture={openCapture}
        onOpenSettings={() => setSettingsOpen(true)}
        showShortcuts={shortcutHints}
      />

      {connectionError ? (
        <div className={styles.connectionAlert} role="alert">
          <CircleAlert size={16} strokeWidth={1.7} aria-hidden="true" />
          <div>
            <strong>Codex bridge needs attention</strong>
            <span>{connectionError}</span>
          </div>
        </div>
      ) : null}

      <main className={styles.main}>
        {state.view === 'kanban' ? (
          state.sessionLayout === 'kanban' ? (
            <KanbanView
              ideas={ideas}
              onOpenSession={openSession}
              onOpenIdea={openIdea}
              onCapture={openCapture}
            />
          ) : (
            <SessionGridView onOpenSession={openSession} />
          )
        ) : (
          <IdeasView ideas={ideas} onOpenIdea={openIdea} onCapture={openCapture} />
        )}
      </main>

      <CaptureSheet
        open={captureOpen}
        onClose={() => setCaptureOpen(false)}
        onSaved={setNotice}
      />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onOpenSession={openSession}
        onOpenIdea={openIdea}
        onOpenCapture={openCapture}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <DetailSheet target={detail} onClose={() => setDetail(null)} />
      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onAddProjects={() => {
          setSettingsOpen(false)
          setProjectOnboardingOpen(true)
        }}
      />
      <ProjectOnboardingDialog
        open={projectOnboardingOpen}
        onClose={() => {
          setProjectOnboardingOpen(false)
          setSettingsOpen(true)
        }}
      />
      {notice ? <div className={styles.toast} role="status">{notice}</div> : null}
    </div>
  )
}

function isEditable(target: EventTarget | null): boolean {
  return target instanceof HTMLElement &&
    (target.isContentEditable || target.matches('input, textarea, select, [role="textbox"]'))
}
