import { describe, expect, test } from 'bun:test'
import type { AgentZenBridgeService } from './bridgeService'
import { createBridgeRequestHandler } from './http'

describe('bridge mutation protocol', () => {
  test('accepts the current mutation route and rejects an older one before changing settings', async () => {
    let focusWrites = 0
    const service = {
      setFocus: async () => {
        focusWrites += 1
        return { protocolVersion: 7 }
      },
    } as unknown as AgentZenBridgeService
    const handler = createBridgeRequestHandler({
      service,
      port: 5274,
      distDirectory: '/missing',
    })

    const current = await handler(new Request('http://127.0.0.1:5274/api/v7/settings/focus', {
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
