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
import type { AgentZenBridge } from '@/bridge/httpBridge'
import type { BridgeSnapshot, LaunchSessionResponse } from '@/bridge/types'
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
  readonly activeCount: number
  readonly launchAvailability: ReturnType<typeof launchAvailability>
  readonly agent: CodexSessionSource['agent']
  readonly sourceMode: CodexSessionSource['mode']
  readonly sourceLabel: string
  readonly sourceReady: boolean
  readonly connectionError: string | null
  readonly projectCandidates: readonly ProjectCandidate[]
  /** Registered projects plus discovered projects that currently own a visible session. */
  readonly availableProjects: readonly Project[]
  readonly projectSourceMode: ProjectDiscoverySource['mode']
  readonly projectSourceLabel: string
  readonly resolvedTheme: 'light' | 'dark'
  readonly projectById: (id: string | null) => Project | null
  readonly logbookFor: (subjectId: string) => readonly LogbookNote[]
  /** Wall clock, ticking once a second, so every duration on screen agrees. */
  readonly now: number
  readonly setFocus: (enabled: boolean, limit: number) => Promise<void>
  readonly registerProjects: (candidateIds: readonly string[]) => Promise<void>
  readonly launchSession: (
    projectId: string,
    prompt: string,
    model?: string | null,
    effort?: string | null,
  ) => Promise<LaunchSessionResponse>
  readonly interruptSession: (threadId: string) => Promise<void>
  readonly steerSession: (threadId: string, prompt: string) => Promise<void>
}

const AgentZenContext = createContext<AgentZenValue | null>(null)

export interface AgentZenProviderProps {
  children: ReactNode
  source?: CodexSessionSource
  projectSource?: ProjectDiscoverySource
  bridge?: AgentZenBridge
  /** Frozen clock for tests. When set, no interval is started. */
  now?: number
  storage?: Storage
}

export function AgentZenProvider({
  children,
  source,
  projectSource,
  bridge,
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
  const [sessions, setSessions] = useState<readonly AgentSession[]>(() =>
    bridge ? [] : sessionSource.snapshot(),
  )
  const [bridgeSnapshot, setBridgeSnapshot] = useState<BridgeSnapshot | null>(() =>
    bridge ? bridge.snapshot() : null,
  )
  const [bridgeReady, setBridgeReady] = useState(!bridge)
  const [clock, setClock] = useState(bootNow)
  const [prefersDark, setPrefersDark] = useState(() =>
    typeof window === 'undefined'
      ? false
      : (window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false),
  )

  useEffect(() => {
    if (bridge) {
      return bridge.subscribe((snapshot) => {
        setBridgeSnapshot(snapshot)
        setBridgeReady(true)
        if (
          !snapshot.connection.connected &&
          snapshot.sessions.length === 0 &&
          snapshot.projects.length === 0
        ) {
          return
        }
        setSessions(snapshot.sessions)
        dispatch({
          type: 'sync-bridge-settings',
          projects: snapshot.projects,
          knownProjectIds: snapshot.projectCandidates.map((project) => project.id),
          activeLimitEnabled: snapshot.focus.enabled,
          activeLimit: snapshot.focus.limit,
        })
      })
    }
    return sessionSource.subscribe(setSessions)
  }, [bridge, sessionSource])

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
    const discoveredProjects: Project[] = (bridgeSnapshot?.projectCandidates ?? []).map(
      ({ id, name, directory, repository }) => ({ id, name, directory, repository }),
    )
    const projectCatalog = new Map<string, Project>()
    for (const project of discoveredProjects) projectCatalog.set(project.id, project)
    for (const project of state.projects) projectCatalog.set(project.id, project)
    const projectById = (id: string | null) => (id ? projectCatalog.get(id) ?? null : null)

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
    const relevantProjectIds = new Set([
      ...live.flatMap((session) => (session.projectId ? [session.projectId] : [])),
      ...state.ideas.flatMap((idea) => (idea.projectId ? [idea.projectId] : [])),
      ...state.projects.map((project) => project.id),
    ])
    const availableProjects = [...projectCatalog.values()]
      .filter((project) => relevantProjectIds.has(project.id))
      .sort((left, right) => left.name.localeCompare(right.name))

    return {
      state,
      dispatch,
      sessions,
      board,
      activeCount,
      launchAvailability: launchAvailability(
        activeCount,
        state.activeLimitEnabled,
        state.activeLimit,
      ),
      agent: sessionSource.agent,
      sourceMode: bridge ? 'live' : sessionSource.mode,
      sourceLabel: bridgeSnapshot?.connection.label ?? sessionSource.label,
      sourceReady: bridgeReady,
      connectionError: bridgeSnapshot?.connection.error ?? null,
      projectCandidates: bridgeSnapshot?.projectCandidates ?? discoverySource.snapshot(),
      availableProjects,
      projectSourceMode: bridge ? 'live' : discoverySource.mode,
      projectSourceLabel: bridge ? 'Local Git discovery' : discoverySource.label,
      resolvedTheme,
      projectById,
      logbookFor: (subjectId) => state.logbook.filter((n) => n.subjectId === subjectId),
      now: clock,
      setFocus: async (enabled, limit) => {
        if (!bridge) {
          dispatch({ type: 'set-active-limit-enabled', enabled })
          dispatch({ type: 'set-active-limit', limit })
          return
        }
        const snapshot = await bridge.setFocus(enabled, limit)
        setBridgeSnapshot(snapshot)
      },
      registerProjects: async (candidateIds) => {
        if (!bridge) {
          const candidates = discoverySource.snapshot()
          dispatch({
            type: 'add-projects',
            projects: candidates.filter((candidate) => candidateIds.includes(candidate.id)),
          })
          return
        }
        const snapshot = await bridge.registerProjects(candidateIds)
        setBridgeSnapshot(snapshot)
      },
      launchSession: async (projectId, prompt, model, effort) => {
        if (!bridge) throw new Error('The fixture source cannot launch Codex.')
        const result = await bridge.launch({ projectId, prompt, model, effort })
        await bridge.refresh()
        return result
      },
      interruptSession: async (threadId) => {
        if (!bridge) throw new Error('The fixture source cannot control Codex.')
        await bridge.interrupt(threadId)
      },
      steerSession: async (threadId, prompt) => {
        if (!bridge) throw new Error('The fixture source cannot control Codex.')
        await bridge.steer(threadId, prompt)
      },
    }
  }, [state, sessions, sessionSource, discoverySource, bridge, bridgeSnapshot, bridgeReady, resolvedTheme, clock])

  return <AgentZenContext.Provider value={value}>{children}</AgentZenContext.Provider>
}

export function useAgentZen(): AgentZenValue {
  const value = useContext(AgentZenContext)
  if (!value) throw new Error('useAgentZen must be used inside AgentZenProvider')
  return value
}
