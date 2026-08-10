import { describe, expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'
import { CodexAppServerClient } from './appServerClient'

describe('CodexAppServerClient', () => {
  test('performs the handshake, routes responses, and emits notifications', async () => {
    const fixture = fileURLToPath(new URL('./test-fixtures/fake-app-server.ts', import.meta.url))
    const client = new CodexAppServerClient({ command: [process.execPath, fixture] })
    const notifications: string[] = []
    client.subscribe((notification) => notifications.push(notification.method))

    const initialized = await client.connect()
    const threads = await client.request('thread/list', { limit: 5 })

    expect(initialized).toMatchObject({ userAgent: 'fake-codex/1.0', platformOs: 'macos' })
    expect(threads).toEqual({ data: [], nextCursor: null, backwardsCursor: null })
    expect(notifications).toContain('turn/plan/updated')
    expect(notifications).toContain('item/tool/requestUserInput')

    await client.close()
  })

  test('retries with a fresh child after initialization times out', async () => {
    const fixture = fileURLToPath(new URL('./test-fixtures/silent-app-server.ts', import.meta.url))
    const client = new CodexAppServerClient({
      command: [process.execPath, fixture],
      requestTimeoutMs: 20,
    })

    await expect(client.connect()).rejects.toThrow('request timed out: initialize')
    expect(client.connectionGeneration).toBe(1)
    await expect(client.connect()).rejects.toThrow('request timed out: initialize')
    expect(client.connectionGeneration).toBe(2)

    await client.close()
  })
})
