import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { discoverProjects, normaliseGitHubRepository } from './projects'

const cleanup: string[] = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('project discovery', () => {
  test('finds Git repositories two levels below a registered root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-zen-projects-'))
    cleanup.push(root)
    const repository = join(root, 'lucharo', 'demo')
    await mkdir(repository, { recursive: true })
    await run('git', ['init', '-b', 'main'], repository)
    await run('git', ['remote', 'add', 'origin', 'git@github.com:lucharo/demo.git'], repository)

    const projects = await discoverProjects([root])

    expect(projects).toHaveLength(1)
    expect(projects[0]).toMatchObject({
      name: 'demo',
      directory: await realpath(repository),
      repository: 'lucharo/demo',
      defaultBranch: 'main',
    })
  })

  test('normalises common GitHub remote forms', () => {
    expect(normaliseGitHubRepository('git@github.com:lucharo/agent-zen.git')).toBe('lucharo/agent-zen')
    expect(normaliseGitHubRepository('https://github.com/lucharo/agent-zen.git')).toBe('lucharo/agent-zen')
    expect(normaliseGitHubRepository('ssh://git@example.com/lucharo/agent-zen.git')).toBeNull()
  })
})

async function run(command: string, args: string[], cwd: string): Promise<void> {
  const process = Bun.spawn([command, ...args], { cwd, stdout: 'pipe', stderr: 'pipe' })
  const exitCode = await process.exited
  if (exitCode !== 0) throw new Error(`${command} failed with exit code ${exitCode}`)
}
