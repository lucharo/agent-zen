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

    await client.close()
  })
})
