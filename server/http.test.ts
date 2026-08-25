import { describe, expect, mock, test } from 'bun:test'
import type { AgentZenBridgeService } from './bridgeService'
import { createBridgeRequestHandler, createFrontendProxyRequestHandler } from './http'

describe('bridge mutation protocol', () => {
  test('coalesces concurrent snapshot reads into one observer pass', async () => {
    let snapshotCalls = 0
    let resolveSnapshot: ((value: { protocolVersion: number }) => void) | undefined
    const pendingSnapshot = new Promise<{ protocolVersion: number }>((resolve) => {
      resolveSnapshot = resolve
    })
    const service = {
      snapshot: () => {
        snapshotCalls += 1
        return pendingSnapshot
      },
    } as unknown as AgentZenBridgeService
    const handler = createBridgeRequestHandler({
      service,
      port: 5274,
      distDirectory: '/missing',
    })
    const request = () => new Request('http://127.0.0.1:5274/api/snapshot', {
      headers: { host: '127.0.0.1:5274' },
    })

    const first = handler(request())
    const second = handler(request())
    await Promise.resolve()

    expect(snapshotCalls).toBe(1)
    resolveSnapshot?.({ protocolVersion: 9 })
    expect(await (await first).json()).toEqual({ protocolVersion: 9 })
    expect(await (await second).json()).toEqual({ protocolVersion: 9 })

    expect((await handler(request())).status).toBe(200)
    expect(snapshotCalls).toBe(2)
  })

  test('releases a failed snapshot so the next read can recover', async () => {
    let snapshotCalls = 0
    const service = {
      snapshot: async () => {
        snapshotCalls += 1
        if (snapshotCalls === 1) throw new Error('observer failed')
        return { protocolVersion: 9 }
      },
    } as unknown as AgentZenBridgeService
    const handler = createBridgeRequestHandler({
      service,
      port: 5274,
      distDirectory: '/missing',
    })
    const request = () => new Request('http://127.0.0.1:5274/api/snapshot', {
      headers: { host: '127.0.0.1:5274' },
    })

    expect((await handler(request())).status).toBe(500)
    expect((await handler(request())).status).toBe(200)
    expect(snapshotCalls).toBe(2)
  })

  test('advertises the current protocol on the lightweight health endpoint', async () => {
    const service = {
      health: () => ({
        protocolVersion: 9,
        connection: { connected: true },
        generatedAt: '2026-08-12T08:00:00.000Z',
      }),
    } as unknown as AgentZenBridgeService
    const handler = createBridgeRequestHandler({
      service,
      port: 5274,
      distDirectory: '/missing',
      runtime: { pid: 4217, version: '0.1.0' },
    })

    const response = await handler(new Request('http://127.0.0.1:5274/api/health', {
      headers: { host: '127.0.0.1:5274' },
    }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      protocolVersion: 9,
      connection: { connected: true },
      generatedAt: '2026-08-12T08:00:00.000Z',
      runtime: { pid: 4217, version: '0.1.0' },
    })
  })

  test('accepts the current mutation route and rejects an older one before changing settings', async () => {
    let focusWrites = 0
    const service = {
      setFocus: async () => {
        focusWrites += 1
        return { protocolVersion: 9 }
      },
    } as unknown as AgentZenBridgeService
    const handler = createBridgeRequestHandler({
      service,
      port: 5274,
      distDirectory: '/missing',
    })

    const current = await handler(new Request('http://127.0.0.1:5274/api/v9/settings/focus', {
      method: 'PUT',
      headers: { host: '127.0.0.1:5274', 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: true, limit: 2 }),
    }))
    const stale = await handler(new Request('http://127.0.0.1:5274/api/v4/settings/focus', {
      method: 'PUT',
      headers: { host: '127.0.0.1:5274', 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: false, limit: 3 }),
    }))

    expect(current.status).toBe(200)
    expect(stale.status).toBe(404)
    expect(focusWrites).toBe(1)
  })
})

describe('native frontend proxy', () => {
  test('serves a bundled build identity while forwarding API requests to the daemon', async () => {
    const fetchUpstream = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/api/health')) {
        return Response.json({
          protocolVersion: 9,
          connection: { connected: true },
          runtime: { pid: 4217, version: '0.1.0' },
        })
      }
      return Response.json({ ok: true, body: init?.body ? new TextDecoder().decode(init.body as ArrayBuffer) : null })
    })
    const handler = createFrontendProxyRequestHandler({
      port: 5275,
      distDirectory: '/missing',
      upstreamBaseUrl: 'http://127.0.0.1:5274',
      frontendBuildId: 'frontend-current',
      fetchUpstream,
    })

    const health = await handler(new Request('http://127.0.0.1:5275/api/health', {
      headers: { host: '127.0.0.1:5275' },
    }))
    const mutation = await handler(new Request('http://127.0.0.1:5275/api/v9/settings/focus', {
      method: 'PUT',
      headers: { host: '127.0.0.1:5275', 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: true, limit: 2 }),
    }))

    expect(await health.json()).toEqual({
      protocolVersion: 9,
      connection: { connected: true },
      runtime: { pid: 4217, version: '0.1.0' },
      frontendBuildId: 'frontend-current',
      frontendApiPort: 5274,
    })
    expect(await mutation.json()).toEqual({
      ok: true,
      body: JSON.stringify({ enabled: true, limit: 2 }),
    })
    expect(fetchUpstream.mock.calls.map(([input]) => String(input))).toEqual([
      'http://127.0.0.1:5274/api/health',
      'http://127.0.0.1:5274/api/v9/settings/focus',
    ])
  })
})
