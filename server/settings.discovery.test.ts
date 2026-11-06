import { afterEach, describe, expect, setSystemTime, test } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentZenSettingsStore } from './settings'
import { fakeGit, type FakeGit } from './test-fixtures/fakeGit'

// One checkout whose files cannot be read, so each discovery round asks (fake) git
// three questions about it: the number of git calls counts the rounds.
const CALLS_PER_ROUND = 3

const cleanup: string[] = []
let activeFake: FakeGit | null = null

afterEach(async () => {
  activeFake?.release()
  activeFake?.restore()
  activeFake = null
  setSystemTime()
  await Promise.all(cleanup.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('AgentZenSettingsStore discovery rounds', () => {
  test('callers during a slow round share it', async () => {
    const store = await storeWithOneUnreadableCheckout()
    activeFake = fakeGit({ hold: true })

    const first = store.discoverProjects()
    const second = store.discoverProjects()
    await waitUntil(() => activeFake!.calls.length >= CALLS_PER_ROUND)
    const third = store.discoverProjects()
    activeFake.release()
    await Promise.all([first, second, third])

    expect(activeFake.calls.length / CALLS_PER_ROUND).toBe(1)
  })

  test('a round slower than the cache lifetime never has a second started beside it', async () => {
    const start = new Date('2026-01-01T10:00:00Z').getTime()
    setSystemTime(start)
    const store = await storeWithOneUnreadableCheckout()
    activeFake = fakeGit({ hold: true })

    const first = store.discoverProjects()
    await waitUntil(() => activeFake!.calls.length >= CALLS_PER_ROUND)
    setSystemTime(start + 45_000)
    const late = store.discoverProjects()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(activeFake.calls.length / CALLS_PER_ROUND).toBe(1)

    activeFake.release()
    await Promise.all([first, late])
    expect(activeFake.calls.length / CALLS_PER_ROUND).toBe(1)
  })

  test('the cache lifetime counts from when the round finished', async () => {
    const start = new Date('2026-01-01T10:00:00Z').getTime()
    setSystemTime(start)
    const store = await storeWithOneUnreadableCheckout()
    activeFake = fakeGit({ hold: true })

    const first = store.discoverProjects()
    await waitUntil(() => activeFake!.calls.length >= CALLS_PER_ROUND)
    setSystemTime(start + 40_000)
    activeFake.release()
    await first

    setSystemTime(start + 40_000 + 29_000)
    await store.discoverProjects()
    expect(activeFake.calls.length / CALLS_PER_ROUND).toBe(1)

    setSystemTime(start + 40_000 + 31_000)
    await store.discoverProjects()
    expect(activeFake.calls.length / CALLS_PER_ROUND).toBe(2)
  })
})

async function storeWithOneUnreadableCheckout(): Promise<AgentZenSettingsStore> {
  const directory = await mkdtemp(join(tmpdir(), 'agent-zen-discovery-'))
  cleanup.push(directory)
  const checkout = join(directory, 'projects', 'acme', 'broken')
  await mkdir(checkout, { recursive: true })
  await writeFile(join(checkout, '.git'), 'gitdir: ../missing-git-dir\n')
  return new AgentZenSettingsStore({
    settingsPath: join(directory, 'settings.json'),
    defaultProjectRoots: [join(directory, 'projects')],
  })
}

async function waitUntil(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = performance.now() + timeoutMs
  while (!condition()) {
    if (performance.now() > deadline) throw new Error('Timed out waiting for the condition.')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}
