import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BridgeSnapshot } from './types'
import { createHttpBridge, resolveBridgeBaseUrl } from './httpBridge'

afterEach(() => vi.unstubAllGlobals())

describe('resolveBridgeBaseUrl', () => {
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
})
