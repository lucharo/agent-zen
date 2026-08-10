import {
  createContext,
  useCallback,
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
import type {
  BridgeSnapshot,
  LaunchSessionResponse,
  SessionRequestResponse,
} from '@/bridge/types'
import { selectUiPreferences } from '@/domain/preferences'
import {
  activeSessionCount,
  classifyAgentSession,
  launchAvailability,
  type ClassifiedAgentSession,
} from '@/domain/stage'
import type { LogbookNote, Project, Stage } from '@/domain/types'
import {
  loadState,
  resolveTheme,
  saveHumanState,
  saveState,
  type PersistedState,
} from './persistence'
import { reducer, type Action } from './reducer'

export interface BoardSession {
  readonly session: ClassifiedAgentSession
  readonly stage: Stage
  readonly project: Project | null
  readonly children: readonly ClassifiedAgentSession[]
}

export interface AgentZenValue {
  readonly state: PersistedState
  readonly dispatch: (action: Action) => void
  readonly sessions: readonly ClassifiedAgentSession[]
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
  readonly respondToSession: (threadId: string, response: SessionRequestResponse) => Promise<void>
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
  const stateRef = useRef(state)
  stateRef.current = state
  const [sessions, setSessions] = useState<readonly ClassifiedAgentSession[]>(() =>
    bridge ? [] : sessionSource.snapshot().map(classifyAgentSession),
  )
  const [bridgeSnapshot, setBridgeSnapshot] = useState<BridgeSnapshot | null>(() =>
    bridge ? bridge.snapshot() : null,
  )
  const [bridgeReady, setBridgeReady] = useState(!bridge)
  const [preferenceBridgeReady, setPreferenceBridgeReady] = useState(!bridge)
  const preferencesHydrated = useRef(!bridge)
  const preferenceMigrationStarted = useRef(false)
  const serverPreferencesSignature = useRef<string | null>(null)
  const localPreferencesDirty = useRef(false)
  const pendingPreferenceWrites = useRef(0)
  const lastQueuedPreferences = useRef<string | null>(null)
  const preferenceWriteQueue = useRef<Promise<void>>(Promise.resolve())
  const preferenceRetryTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [preferenceRetryVersion, setPreferenceRetryVersion] = useState(0)
  const [clock, setClock] = useState(bootNow)
  const [prefersDark, setPrefersDark] = useState(() =>
    typeof window === 'undefined'
      ? false
      : (window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false),
  )

  const enqueuePreferences = useCallback((preferences: ReturnType<typeof selectUiPreferences>) => {
    if (!bridge) return Promise.resolve()
    const signature = JSON.stringify(preferences)
    if (signature === lastQueuedPreferences.current) return preferenceWriteQueue.current
    lastQueuedPreferences.current = signature
    pendingPreferenceWrites.current += 1
    const operation = preferenceWriteQueue.current
      .catch(() => undefined)
      .then(async () => {
        const snapshot = await bridge.setPreferences(preferences)
        setBridgeSnapshot(snapshot)
        const persisted = snapshot.preferences ?? preferences
        serverPreferencesSignature.current = JSON.stringify(persisted)
        if (JSON.stringify(selectUiPreferences(stateRef.current)) === signature) {
          localPreferencesDirty.current = false
        }
      })
      .catch((error) => {
        localPreferencesDirty.current = true
        if (!preferenceRetryTimer.current) {
          preferenceRetryTimer.current = setTimeout(() => {
            preferenceRetryTimer.current = null
            setPreferenceRetryVersion((version) => version + 1)
          }, 1_000)
        }
        throw error
      })
      .finally(() => {
        pendingPreferenceWrites.current -= 1
        if (lastQueuedPreferences.current === signature) lastQueuedPreferences.current = null
      })
    preferenceWriteQueue.current = operation.then(() => undefined, () => undefined)
    return operation
  }, [bridge])

  useEffect(() => {
    if (bridge) {
      return bridge.subscribe((snapshot) => {
        setBridgeSnapshot(snapshot)
        setBridgeReady(true)
        dispatch({ type: 'set-active-limit-enabled', enabled: snapshot.focus.enabled })
        dispatch({ type: 'set-active-limit', limit: snapshot.focus.limit })

        if (snapshot.preferences !== null) {
          const previousServerSignature = serverPreferencesSignature.current
          const currentSignature = JSON.stringify(selectUiPreferences(stateRef.current))
          const hasUnpersistedLocalChange =
            localPreferencesDirty.current ||
            pendingPreferenceWrites.current > 0 ||
            (preferencesHydrated.current &&
              previousServerSignature !== null &&
              currentSignature !== previousServerSignature)
          const incomingSignature = JSON.stringify(snapshot.preferences)
          serverPreferencesSignature.current = incomingSignature
          if (!preferencesHydrated.current || !hasUnpersistedLocalChange) {
            dispatch({ type: 'sync-ui-preferences', preferences: snapshot.preferences })
            localPreferencesDirty.current = false
          }
          preferencesHydrated.current = true
          setPreferenceBridgeReady(true)
        } else if (
          !preferencesHydrated.current &&
          !preferenceMigrationStarted.current
        ) {
          preferenceMigrationStarted.current = true
          const preferences = selectUiPreferences(stateRef.current)
          localPreferencesDirty.current = true
          void enqueuePreferences(preferences).then(() => {
            preferencesHydrated.current = true
            preferenceMigrationStarted.current = false
            setPreferenceBridgeReady(true)
          }).catch(() => {
            preferenceMigrationStarted.current = false
          })
        }

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
    return sessionSource.subscribe((next) => setSessions(next.map(classifyAgentSession)))
  }, [bridge, enqueuePreferences, sessionSource])

  useEffect(() => () => {
    if (preferenceRetryTimer.current) clearTimeout(preferenceRetryTimer.current)
  }, [])

  useEffect(() => {
    if (now !== undefined) return
    const timer = setInterval(() => setClock(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [now])

  useEffect(() => {
    if (bridge) saveHumanState(store, state)
    else saveState(store, state)
  }, [bridge, store, state])

  useEffect(() => {
    if (!bridge || !preferenceBridgeReady) return
    const preferences = selectUiPreferences(state)
    const signature = JSON.stringify(preferences)
    if (signature === serverPreferencesSignature.current) {
      localPreferencesDirty.current = false
      return
    }
    localPreferencesDirty.current = true
    void enqueuePreferences(preferences).catch(() => undefined)
  }, [bridge, enqueuePreferences, preferenceBridgeReady, preferenceRetryVersion, state])

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

    const stageOf = (session: ClassifiedAgentSession) => session.classification.stage

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
      respondToSession: async (threadId, response) => {
        if (!bridge) throw new Error('The fixture source cannot control Codex.')
        await bridge.respond(threadId, response)
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
