import {
  BRIDGE_PROTOCOL_VERSION,
  BRIDGE_MUTATION_PATH,
  type BridgeSnapshot,
  type LaunchSessionPayload,
  type LaunchSessionResponse,
  type SessionRequestResponse,
} from './types'
import type { UiPreferences } from '@/domain/preferences'

export interface AgentZenBridge {
  readonly mode: 'live'
  snapshot(): BridgeSnapshot
  subscribe(listener: (snapshot: BridgeSnapshot) => void): () => void
  refresh(): Promise<BridgeSnapshot>
  setFocus(enabled: boolean, limit: number): Promise<BridgeSnapshot>
  setPreferences(preferences: UiPreferences): Promise<BridgeSnapshot>
  registerProjects(candidateIds: readonly string[]): Promise<BridgeSnapshot>
  launch(payload: LaunchSessionPayload): Promise<LaunchSessionResponse>
  interrupt(threadId: string): Promise<void>
  steer(threadId: string, prompt: string): Promise<void>
  respond(threadId: string, response: SessionRequestResponse): Promise<void>
}

const EMPTY: BridgeSnapshot = {
  protocolVersion: BRIDGE_PROTOCOL_VERSION,
  generatedAt: new Date(0).toISOString(),
  connection: {
    connected: false,
    label: 'Connecting to agents…',
    userAgent: null,
    error: null,
  },
  backends: [],
  sessions: [],
  focus: {
    enabled: false,
    limit: 3,
    activeCount: 0,
    availability: { allowed: true, reason: 'limit-disabled' },
  },
  preferences: null,
  projects: [],
  projectCandidates: [],
}

export const SNAPSHOT_POLL_INTERVAL_MS = 1_000

export function createHttpBridge(
  baseUrl = resolveBridgeBaseUrl(
    import.meta.env.VITE_AGENT_ZEN_BRIDGE_URL,
    typeof window === 'undefined' ? null : window.location,
    import.meta.env.MODE === 'development',
  ),
): AgentZenBridge {
  let current = EMPTY
  let timer: ReturnType<typeof setInterval> | null = null
  let polling = false
  const listeners = new Set<(snapshot: BridgeSnapshot) => void>()

  const emit = (snapshot: BridgeSnapshot) => {
    current = snapshot
    for (const listener of listeners) listener(snapshot)
  }

  const request = async <T>(
    pathname: string,
    init?: RequestInit,
    timeoutMs: number | null = 12_000,
  ): Promise<T> => {
    const controller = timeoutMs === null ? null : new AbortController()
    const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs ?? 0) : null
    try {
      const response = await fetch(`${baseUrl}${pathname}`, {
        ...init,
        cache: 'no-store',
        ...(controller ? { signal: controller.signal } : {}),
        headers: {
          ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
          ...init?.headers,
        },
      })
      const body = (await response.json().catch(() => null)) as T | { error?: string; message?: string } | null
      if (!response.ok) {
        const detail = body && typeof body === 'object' && 'message' in body
          ? body.message
          : body && typeof body === 'object' && 'error' in body
            ? body.error
            : null
        throw new Error(typeof detail === 'string' ? detail : `Bridge request failed (${response.status}).`)
      }
      return body as T
    } finally {
      if (timeout) clearTimeout(timeout)
    }
  }

  const acceptSnapshot = (snapshot: BridgeSnapshot) => {
    if (snapshot.protocolVersion !== BRIDGE_PROTOCOL_VERSION) {
      throw new Error('Restart Agent Zen: the dashboard and local bridge are from different builds.')
    }
    emit(snapshot)
    return snapshot
  }

  const refresh = async () => {
    if (polling) return current
    polling = true
    try {
      const snapshot = await request<BridgeSnapshot>('/api/snapshot')
      return acceptSnapshot(snapshot)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const snapshot: BridgeSnapshot = {
        ...current,
        generatedAt: new Date().toISOString(),
        connection: {
          ...current.connection,
          connected: false,
          label: 'Agent Zen bridge unavailable',
          error: message,
        },
      }
      emit(snapshot)
      return snapshot
    } finally {
      polling = false
    }
  }

  const updateSnapshot = async (pathname: string, body: unknown) => {
    const snapshot = await request<BridgeSnapshot>(pathname, {
      method: pathname.includes('/settings/') ? 'PUT' : 'POST',
      body: JSON.stringify(body),
    })
    return acceptSnapshot(snapshot)
  }

  return {
    mode: 'live',
    snapshot: () => current,
    subscribe(listener) {
      listeners.add(listener)
      if (current.generatedAt !== EMPTY.generatedAt) listener(current)
      if (!timer) {
        void refresh()
        timer = setInterval(() => void refresh(), SNAPSHOT_POLL_INTERVAL_MS)
      }
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0 && timer) {
          clearInterval(timer)
          timer = null
        }
      }
    },
    refresh,
    setFocus: (enabled, limit) => updateSnapshot(`${BRIDGE_MUTATION_PATH}/settings/focus`, { enabled, limit }),
    setPreferences: (preferences) =>
      updateSnapshot(`${BRIDGE_MUTATION_PATH}/settings/preferences`, preferences),
    registerProjects: (candidateIds) =>
      updateSnapshot(`${BRIDGE_MUTATION_PATH}/projects/register`, { candidateIds }),
    launch: (payload) =>
      request<LaunchSessionResponse>(`${BRIDGE_MUTATION_PATH}/sessions/launch`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }, null),
    interrupt: async (threadId) => {
      await request(`${BRIDGE_MUTATION_PATH}/sessions/${encodeURIComponent(threadId)}/interrupt`, { method: 'POST' })
      await refresh()
    },
    steer: async (threadId, prompt) => {
      await request(`${BRIDGE_MUTATION_PATH}/sessions/${encodeURIComponent(threadId)}/steer`, {
        method: 'POST',
        body: JSON.stringify({ prompt }),
      })
      await refresh()
    },
    respond: async (threadId, response) => {
      await request(`${BRIDGE_MUTATION_PATH}/sessions/${encodeURIComponent(threadId)}/respond`, {
        method: 'POST',
        body: JSON.stringify(response),
      })
      await refresh()
    },
  }
}

export function resolveBridgeBaseUrl(
  configured: string | undefined,
  location: Pick<Location, 'origin' | 'port'> | null,
  development: boolean,
): string {
  if (configured) return configured
  if (!development && location) return location.origin
  return 'http://127.0.0.1:5274'
}
