import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentZenSettingsStore } from './settings'

const cleanup: string[] = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('AgentZenSettingsStore', () => {
  test('migrates version 1 settings without losing focus or project registration', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-zen-settings-v1-'))
    cleanup.push(directory)
    const settingsPath = join(directory, 'settings.json')
    await writeFile(settingsPath, JSON.stringify({
      version: 1,
      focus: { enabled: true, limit: 4 },
      projectRoots: ['/projects'],
      registeredProjectDirectories: ['/projects/lucharo/demo'],
    }))

    const store = new AgentZenSettingsStore({ settingsPath, defaultProjectRoots: ['/fallback'] })
    expect(await store.read()).toEqual({
      version: 2,
      focus: { enabled: true, limit: 4 },
      preferences: null,
      projectRoots: ['/projects'],
      registeredProjectDirectories: ['/projects/lucharo/demo'],
    })

    await store.setPreferences({
      theme: 'system',
      view: 'kanban',
      projectFilter: null,
      ideaGroupBy: 'created',
      ideaLayout: 'grid',
      sessionLayout: 'grid',
      kanbanGroupBy: 'none',
      kanbanCardDetail: 'titles',
      ideasFolded: false,
    })
    expect(JSON.parse(await readFile(settingsPath, 'utf8'))).toMatchObject({
      version: 2,
      focus: { enabled: true, limit: 4 },
      registeredProjectDirectories: ['/projects/lucharo/demo'],
    })
  })

  test('keeps committed state after a failed write and recovers the settings queue', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-zen-settings-failure-'))
    cleanup.push(directory)
    const blockedParent = join(directory, 'blocked')
    await writeFile(blockedParent, 'not a directory')
    const settingsPath = join(blockedParent, 'settings.json')
    const store = new AgentZenSettingsStore({ settingsPath, defaultProjectRoots: ['/projects'] })

    await expect(store.setPreferences({
      theme: 'dark',
      view: 'ideas',
      projectFilter: null,
      ideaGroupBy: 'project',
      ideaLayout: 'list',
      sessionLayout: 'grid',
      kanbanGroupBy: 'project',
      kanbanCardDetail: 'details',
      ideasFolded: true,
    })).rejects.toThrow()
    expect((await store.read()).preferences).toBeNull()

    await rm(blockedParent)
    await mkdir(blockedParent)
    await store.setFocus({ enabled: true, limit: 2 })

    const reloaded = new AgentZenSettingsStore({ settingsPath, defaultProjectRoots: ['/projects'] })
    expect(await reloaded.read()).toMatchObject({
      focus: { enabled: true, limit: 2 },
      preferences: null,
    })
  })

  test('merges writes from multiple bridge processes instead of restoring stale settings', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-zen-settings-processes-'))
    cleanup.push(directory)
    const settingsPath = join(directory, 'settings.json')
    const first = new AgentZenSettingsStore({ settingsPath, defaultProjectRoots: ['/projects'] })
    const second = new AgentZenSettingsStore({ settingsPath, defaultProjectRoots: ['/projects'] })
    await Promise.all([first.read(), second.read()])

    await Promise.all([
      first.setPreferences({
        theme: 'dark',
        view: 'ideas',
        projectFilter: null,
        ideaGroupBy: 'project',
        ideaLayout: 'list',
        sessionLayout: 'grid',
        kanbanGroupBy: 'project',
        kanbanCardDetail: 'details',
        ideasFolded: true,
      }),
      second.setFocus({ enabled: true, limit: 2 }),
    ])

    const reloaded = new AgentZenSettingsStore({ settingsPath, defaultProjectRoots: ['/projects'] })
    expect(await reloaded.read()).toMatchObject({
      focus: { enabled: true, limit: 2 },
      preferences: { theme: 'dark', view: 'ideas', sessionLayout: 'grid' },
    })
  })

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
    await store.setPreferences({
      theme: 'dark',
      view: 'ideas',
      projectFilter: candidates[0]!.id,
      ideaGroupBy: 'project',
      ideaLayout: 'list',
      sessionLayout: 'grid',
      kanbanGroupBy: 'project',
      kanbanCardDetail: 'details',
      ideasFolded: true,
    })

    const reloaded = new AgentZenSettingsStore({ settingsPath, defaultProjectRoots: [root] })
    expect((await reloaded.read()).focus).toEqual({ enabled: true, limit: 2 })
    expect((await reloaded.read()).preferences).toEqual({
      theme: 'dark',
      view: 'ideas',
      projectFilter: candidates[0]!.id,
      ideaGroupBy: 'project',
      ideaLayout: 'list',
      sessionLayout: 'grid',
      kanbanGroupBy: 'project',
      kanbanCardDetail: 'details',
      ideasFolded: true,
    })
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
