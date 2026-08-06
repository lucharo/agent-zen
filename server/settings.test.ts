import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentZenSettingsStore } from './settings'

const cleanup: string[] = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('AgentZenSettingsStore', () => {
  test('persists the disabled-by-default focus policy and registers only discovered projects', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-zen-settings-'))
    cleanup.push(directory)
    const root = join(directory, 'projects')
    const repository = join(root, 'lucharo', 'demo')
    await mkdir(repository, { recursive: true })
    await run('git', ['init', '-b', 'main'], repository)
    await run('git', ['remote', 'add', 'origin', 'https://github.com/lucharo/demo.git'], repository)

    const settingsPath = join(directory, 'settings.json')
    const store = new AgentZenSettingsStore({ settingsPath, defaultProjectRoots: [root] })
    expect((await store.read()).focus).toEqual({ enabled: false, limit: 3 })

    const candidates = await store.discoverProjects()
    await store.registerProjects([candidates[0]!.id])
    await store.setFocus({ enabled: true, limit: 2 })

    const reloaded = new AgentZenSettingsStore({ settingsPath, defaultProjectRoots: [root] })
    expect((await reloaded.read()).focus).toEqual({ enabled: true, limit: 2 })
    expect(await reloaded.registeredProjects()).toMatchObject([
      { directory: expect.stringContaining('/lucharo/demo'), repository: 'lucharo/demo' },
    ])
    await expect(reloaded.registerProjects(['not-a-candidate'])).rejects.toThrow('Unknown project candidate')
  })
})

async function run(command: string, args: string[], cwd: string): Promise<void> {
  const process = Bun.spawn([command, ...args], { cwd, stdout: 'pipe', stderr: 'pipe' })
  if ((await process.exited) !== 0) throw new Error(`${command} failed`)
}
