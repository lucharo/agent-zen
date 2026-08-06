import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { CodexSessionSource } from '@/adapters/CodexSessionSource'
import { createFixtureSessionSource } from '@/adapters/fixtureSource'
import type {
  ProjectCandidate,
  ProjectDiscoverySource,
} from '@/adapters/ProjectDiscoverySource'
import { createFixtureProjectDiscoverySource } from '@/adapters/fixtureProjectSource'
import { activeSessionCount, deriveStage, launchAvailability } from '@/domain/stage'
import type { AgentSession, LogbookNote, Project, Stage } from '@/domain/types'
import { loadState, resolveTheme, saveState, type PersistedState } from './persistence'
import { reducer, type Action } from './reducer'

export interface BoardSession {
  readonly session: AgentSession
  readonly stage: Stage
  readonly project: Project | null
  readonly children: readonly AgentSession[]
}

export interface AgentZenValue {
  readonly state: PersistedState
  readonly dispatch: (action: Action) => void
  readonly sessions: readonly AgentSession[]
  readonly board: readonly BoardSession[]
  readonly archived: readonly AgentSession[]
  readonly activeCount: number
  readonly launchAvailability: ReturnType<typeof launchAvailability>
  readonly agent: CodexSessionSource['agent']
  readonly sourceMode: CodexSessionSource['mode']
  readonly sourceLabel: string
  readonly projectCandidates: readonly ProjectCandidate[]
  readonly projectSourceMode: ProjectDiscoverySource['mode']
  readonly projectSourceLabel: string
  readonly resolvedTheme: 'light' | 'dark'
  readonly projectById: (id: string | null) => Project | null
  readonly logbookFor: (subjectId: string) => readonly LogbookNote[]
  /** Wall clock, ticking once a second, so every duration on screen agrees. */
  readonly now: number
}

const AgentZenContext = createContext<AgentZenValue | null>(null)

export interface AgentZenProviderProps {
  children: ReactNode
  source?: CodexSessionSource
  projectSource?: ProjectDiscoverySource
  /** Frozen clock for tests. When set, no interval is started. */
  now?: number
  storage?: Storage
}

export function AgentZenProvider({
  children,
  source,
  projectSource,
  now,
  storage,
}: AgentZenProviderProps) {
  const bootNow = useRef(now ?? Date.now()).current
  const store = useRef(
    storage ?? (typeof window === 'undefined' ? undefined : window.localStorage),
  ).current
  const sessionSource = useRef(source ?? createFixtureSessionSource()).current
  const discoverySource = useRef(projectSource ?? createFixtureProjectDiscoverySource()).current

  const [state, dispatch] = useReducer(reducer, undefined, () => loadState(store, bootNow))
  const [sessions, setSessions] = useState<readonly AgentSession[]>(() => sessionSource.snapshot())
  const [clock, setClock] = useState(bootNow)
  const [prefersDark, setPrefersDark] = useState(() =>
    typeof window === 'undefined'
      ? false
      : (window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false),
  )

  useEffect(() => sessionSource.subscribe(setSessions), [sessionSource])

  useEffect(() => {
    if (now !== undefined) return
    const timer = setInterval(() => setClock(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [now])

  useEffect(() => {
    saveState(store, state)
  }, [store, state])

  const resolvedTheme = resolveTheme(state.theme, prefersDark)

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!media) return
    const listener = (event: MediaQueryListEvent) => setPrefersDark(event.matches)
    media.addEventListener('change', listener)
    return () => media.removeEventListener('change', listener)
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme
    document.documentElement.dataset.themeChoice = state.theme
  }, [resolvedTheme, state.theme])

  const value = useMemo<AgentZenValue>(() => {
    const projectById = (id: string | null) =>
      id ? (state.projects.find((p) => p.id === id) ?? null) : null

    const stageOf = (session: AgentSession) => deriveStage(session)

    const live = sessions.filter((s) => stageOf(s) !== null)
    const board: BoardSession[] = live
      .filter((s) => !s.parentSessionId)
      .map((session) => ({
        session,
        stage: stageOf(session) as Stage,
        project: projectById(session.projectId),
        children: live.filter((c) => c.parentSessionId === session.id),
      }))

    const activeCount = activeSessionCount(live, stageOf)

    return {
      state,
      dispatch,
      sessions,
      board,
      archived: sessions.filter((s) => s.endedAt !== null),
      activeCount,
      launchAvailability: launchAvailability(
        activeCount,
        state.activeLimitEnabled,
        state.activeLimit,
      ),
      agent: sessionSource.agent,
      sourceMode: sessionSource.mode,
      sourceLabel: sessionSource.label,
      projectCandidates: discoverySource.snapshot(),
      projectSourceMode: discoverySource.mode,
      projectSourceLabel: discoverySource.label,
      resolvedTheme,
      projectById,
      logbookFor: (subjectId) => state.logbook.filter((n) => n.subjectId === subjectId),
      now: clock,
    }
  }, [state, sessions, sessionSource, discoverySource, resolvedTheme, clock])

  return <AgentZenContext.Provider value={value}>{children}</AgentZenContext.Provider>
}

export function useAgentZen(): AgentZenValue {
  const value = useContext(AgentZenContext)
  if (!value) throw new Error('useAgentZen must be used inside AgentZenProvider')
  return value
}
