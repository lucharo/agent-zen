import { useCallback, useEffect, useState } from 'react'
import { filterIdeas } from '@/domain/ideas'
import { useAgentZen } from '@/state/store'
import { ArchiveSheet } from '@/components/ArchiveSheet'
import { CaptureSheet } from '@/components/CaptureSheet'
import { CommandPalette } from '@/components/CommandPalette'
import { DetailSheet, type DetailTarget } from '@/components/DetailSheet'
import { IdeasView } from '@/components/IdeasView'
import { KanbanView } from '@/components/KanbanView'
import { ProjectOnboardingDialog } from '@/components/ProjectOnboardingDialog'
import { SettingsDialog } from '@/components/SettingsDialog'
import { Toolbar } from '@/components/Toolbar'
import styles from './App.module.css'

export function App() {
  const { state, dispatch } = useAgentZen()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [captureOpen, setCaptureOpen] = useState(false)
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [projectOnboardingOpen, setProjectOnboardingOpen] = useState(false)
  const [detail, setDetail] = useState<DetailTarget>(null)

  const ideas = filterIdeas(state.ideas, { projectId: state.projectFilter })

  const openSession = useCallback((id: string) => {
    setArchiveOpen(false)
    setDetail({ kind: 'session', id })
  }, [])
  const openIdea = useCallback((id: string) => setDetail({ kind: 'idea', id }), [])
  const openCapture = useCallback(() => setCaptureOpen(true), [])
  const openArchive = useCallback(() => setArchiveOpen(true), [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey
      const key = event.key.toLowerCase()

      if (meta && key === 'k') {
        event.preventDefault()
        setPaletteOpen(true)
        return
      }
      if (meta && key === 'n') {
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
        setArchiveOpen(false)
        setSettingsOpen(false)
        setProjectOnboardingOpen(false)
        setDetail(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [dispatch])

  return (
    <div className={styles.app}>
      <Toolbar
        ideaCount={ideas.length}
        onOpenPalette={() => setPaletteOpen(true)}
        onOpenCapture={openCapture}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <main className={styles.main}>
        {state.view === 'kanban' ? (
          <KanbanView
            ideas={ideas}
            onOpenSession={openSession}
            onOpenIdea={openIdea}
            onOpenArchive={openArchive}
            onCapture={openCapture}
          />
        ) : (
          <IdeasView ideas={ideas} onOpenIdea={openIdea} />
        )}
      </main>

      <CaptureSheet open={captureOpen} onClose={() => setCaptureOpen(false)} />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onOpenSession={openSession}
        onOpenIdea={openIdea}
        onOpenCapture={openCapture}
        onOpenArchive={openArchive}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <ArchiveSheet
        open={archiveOpen}
        onClose={() => setArchiveOpen(false)}
        onOpenSession={openSession}
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
    </div>
  )
}
