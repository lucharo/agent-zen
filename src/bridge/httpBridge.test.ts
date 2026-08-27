import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BridgeSnapshot } from './types'
import { createHttpBridge, resolveBridgeBaseUrl, SNAPSHOT_POLL_INTERVAL_MS } from './httpBridge'

const preferences = {
  theme: 'dark',
  view: 'ideas',
  projectFilter: null,
  ideaGroupBy: 'project',
  ideaLayout: 'list',
  sessionLayout: 'grid',
  kanbanGroupBy: 'project',
  kanbanCardDetail: 'comments',
  ideasFolded: true,
  foldedSessionLanes: ['planning'],
  showCollapsedLanes: false,
  highlightNeedsYou: false,
  constrainBoardWidth: false,
} as const

afterEach(() => vi.unstubAllGlobals())

describe('resolveBridgeBaseUrl', () => {
  it('polls local Codex state every second', () => {
    expect(SNAPSHOT_POLL_INTERVAL_MS).toBe(1_000)
  })

  it('uses an explicit configured bridge', () => {
    expect(resolveBridgeBaseUrl('http://127.0.0.1:9000', null, true)).toBe('http://127.0.0.1:9000')
  })

  it('keeps Vite development on any port pointed at the standard bridge', () => {
    expect(resolveBridgeBaseUrl(undefined, { origin: 'http://127.0.0.1:5280', port: '5280' }, true))
      .toBe('http://127.0.0.1:5274')
  })

  it('uses the serving origin in a packaged app', () => {
    expect(resolveBridgeBaseUrl(undefined, { origin: 'http://127.0.0.1:5275', port: '5275' }, false))
      .toBe('http://127.0.0.1:5275')
  })
})

describe('bridge compatibility', () => {
  it('refuses a stale bridge instead of showing misleading session state', async () => {
    const staleSnapshot = {
      generatedAt: new Date().toISOString(),
      connection: { connected: true, label: 'Old bridge', userAgent: null, error: null },
      sessions: [{ id: 'stale-session', projectId: null }],
      focus: {
        enabled: false,
        limit: 3,
        activeCount: 1,
        availability: { allowed: true, reason: 'limit-disabled' },
      },
      projects: [],
      projectCandidates: [],
    }
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(staleSnapshot)))
    const bridge = createHttpBridge('http://127.0.0.1:9999')
    const seen: BridgeSnapshot[] = []
    const unsubscribe = bridge.subscribe((snapshot) => seen.push(snapshot))

    await vi.waitFor(() => {
      expect(seen.at(-1)?.connection.error).toMatch(/restart agent zen/i)
      expect(seen.at(-1)?.sessions).toEqual([])
    })
    unsubscribe()
  })

  it('persists UI preferences through the local settings endpoint', async () => {
    const snapshot: BridgeSnapshot = {
      protocolVersion: 10,
      generatedAt: new Date().toISOString(),
      connection: { connected: true, label: 'Live Codex', userAgent: null, error: null },
      sessions: [],
      focus: {
        enabled: false,
        limit: 3,
        activeCount: 0,
        availability: { allowed: true, reason: 'limit-disabled' },
      },
      preferences,
      projects: [],
      projectCandidates: [],
    }
    const fetch = vi.fn(async () => Response.json(snapshot))
    vi.stubGlobal('fetch', fetch)
    const bridge = createHttpBridge('http://127.0.0.1:9999')

    await bridge.setPreferences(preferences)

    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:9999/api/v10/settings/preferences',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify(preferences),
        cache: 'no-store',
      }),
    )
  })

  it('answers an owned Codex request through the local bridge', async () => {
    const snapshot: BridgeSnapshot = {
      protocolVersion: 10,
      generatedAt: new Date().toISOString(),
      connection: { connected: true, label: 'Live Codex', userAgent: null, error: null },
      sessions: [],
      focus: {
        enabled: false,
        limit: 3,
        activeCount: 0,
        availability: { allowed: true, reason: 'limit-disabled' },
      },
      preferences,
      projects: [],
      projectCandidates: [],
    }
    const fetch = vi.fn(async (input: RequestInfo | URL) => (
      Response.json(String(input).endsWith('/api/snapshot') ? snapshot : { ok: true })
    ))
    vi.stubGlobal('fetch', fetch)
    const bridge = createHttpBridge('http://127.0.0.1:9999')

    await bridge.respond('thread-owned', {
      requestId: 41,
      kind: 'approval',
      decision: 'accept',
    })

    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:9999/api/v10/sessions/thread-owned/respond',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ requestId: 41, kind: 'approval', decision: 'accept' }),
      }),
    )
  })

  it('does not client-abort a non-idempotent session launch', async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.signal).toBeUndefined()
      return Response.json({ threadId: 'thread-owned', turnId: 'turn-owned' })
    })
    vi.stubGlobal('fetch', fetch)
    const bridge = createHttpBridge('http://127.0.0.1:9999')

    await expect(bridge.launch({ projectId: 'project', prompt: 'Do the work' })).resolves.toEqual({
      threadId: 'thread-owned',
      turnId: 'turn-owned',
    })
  })

  it('refuses stale bridge mutation responses', async () => {
    const fetch = vi.fn(async () => Response.json({
      protocolVersion: 3,
      generatedAt: new Date().toISOString(),
      connection: { connected: true, label: 'Old bridge', userAgent: null, error: null },
      sessions: [],
      focus: {
        enabled: false,
        limit: 3,
        activeCount: 0,
        availability: { allowed: true, reason: 'limit-disabled' },
      },
      projects: [],
      projectCandidates: [],
    }))
    vi.stubGlobal('fetch', fetch)
    const bridge = createHttpBridge('http://127.0.0.1:9999')

    await expect(bridge.setFocus(true, 2)).rejects.toThrow(/different builds/i)
    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:9999/api/v10/settings/focus',
      expect.objectContaining({ method: 'PUT' }),
    )
  })
})
