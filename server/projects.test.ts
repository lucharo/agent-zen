import { afterAll, afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test'
import { appendFile, mkdtemp, mkdir, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as projects from './projects'
import { discoverProjects, gitOriginUrl, normaliseGitHubRepository } from './projects'
import { fakeGit, type FakeGit } from './test-fixtures/fakeGit'

// The fixtures start real git processes and write many files; on a loaded machine
// that alone can outlast the default five seconds.
setDefaultTimeout(60_000)

const cleanup: string[] = []
const sharedCleanup: string[] = []
let activeFake: FakeGit | null = null
let sharedFixtures: ReturnType<typeof buildGitFixtures> | null = null

afterEach(async () => {
  activeFake?.release()
  activeFake?.restore()
  activeFake = null
  await Promise.all(cleanup.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

afterAll(async () => {
  await Promise.all(sharedCleanup.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('project discovery', () => {
  test('finds Git repositories two levels below a registered root', async () => {
    const root = await tempRoot()
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

  test('describes about 90 checkouts without starting a single process', async () => {
    const root = await tempRoot()
    await Promise.all(Array.from({ length: 90 }, (_, index) =>
      fileRepository(join(root, `owner-${index % 9}`, `repo-${index}`), {
        origin: `git@github.com:owner-${index % 9}/repo-${index}.git`,
        head: 'ref: refs/heads/work',
        remoteHead: 'ref: refs/remotes/origin/trunk',
      })))
    activeFake = fakeGit()

    const found = await discoverProjects([root])

    expect(activeFake.calls).toHaveLength(0)
    expect(found).toHaveLength(90)
    expect(found.find((project) => project.name === 'repo-0')).toMatchObject({
      repository: 'owner-0/repo-0',
      defaultBranch: 'trunk',
    })
  })

  test('asks git about unreadable checkouts through a small pool', async () => {
    const root = await tempRoot()
    for (let index = 0; index < 20; index += 1) {
      const directory = join(root, 'owner', `broken-${index}`)
      await mkdir(directory, { recursive: true })
      await writeFile(join(directory, '.git'), 'gitdir: ../missing-git-dir\n')
    }
    activeFake = fakeGit({ hold: true })

    const discovery = discoverProjects([root])
    await waitUntil(() => activeFake!.calls.length > 0)
    await new Promise((resolve) => setTimeout(resolve, 50))
    const liveWhileHeld = activeFake.live()
    activeFake.release()
    const found = await discovery

    expect(liveWhileHeld).toBeLessThanOrEqual(4)
    expect(activeFake.maxLive()).toBeLessThanOrEqual(4)
    expect(activeFake.calls).toHaveLength(60)
    expect(found).toHaveLength(20)
    expect(found[0]).toMatchObject({ repository: null, defaultBranch: null })
  })

  test('reads branch, origin and default branch the way git reports them', async () => {
    const { root: _root, ...fixtures } = await gitFixtures()
    const readCheckout = projects.readCheckout
    expect(typeof readCheckout).toBe('function')

    const expected = {
      main: { origin: 'https://github.com/acme/demo.git', remoteHead: 'origin/trunk', branch: 'main' },
      worktree: { origin: 'https://github.com/acme/demo.git', remoteHead: 'origin/trunk', branch: 'feat' },
      detached: { origin: 'https://github.com/acme/demo.git', remoteHead: 'origin/trunk', branch: null },
      solo: { origin: null, remoteHead: null, branch: 'solo' },
      gitfile: { origin: 'git@github.com:acme/moved.git', remoteHead: null, branch: 'main' },
      quoted: { origin: 'git@github.com:acme/quoted.git', remoteHead: null, branch: 'main' },
    } as const
    for (const [name, directory] of Object.entries(fixtures)) {
      const fromGit = await gitView(directory)
      expect({ name, ...fromGit }).toEqual({ name, ...expected[name as keyof typeof expected] })
      expect({ name, ...(await readCheckout(directory)) }).toEqual({ name, ...fromGit })
    }
  })

  test('discovery reports the default branch of worktrees, detached and origin-less checkouts', async () => {
    const fixtures = await gitFixtures()
    const found = await discoverProjects([fixtures.root])
    const byName = new Map(found.map((project) => [project.name, project]))

    expect(byName.get('main')).toMatchObject({ repository: 'acme/demo', defaultBranch: 'trunk' })
    expect(byName.get('worktree')).toMatchObject({ repository: 'acme/demo', defaultBranch: 'trunk' })
    expect(byName.get('detached')).toMatchObject({ repository: 'acme/demo', defaultBranch: 'trunk' })
    expect(byName.get('solo')).toMatchObject({ repository: null, defaultBranch: 'solo' })
    expect(byName.get('gitfile')).toMatchObject({ repository: 'acme/moved', defaultBranch: 'main' })
  })

  test('returns null for a checkout it cannot read, so git is asked instead', async () => {
    const readCheckout = projects.readCheckout
    expect(typeof readCheckout).toBe('function')
    const root = await tempRoot()
    const pointer = join(root, 'pointer')
    await mkdir(pointer, { recursive: true })
    await writeFile(join(pointer, '.git'), 'gitdir: ../missing\n')
    const reftable = join(root, 'reftable')
    await fileRepository(reftable, { origin: 'git@github.com:acme/r.git', head: 'ref: refs/heads/.invalid' })
    await appendFile(join(reftable, '.git', 'config'), '[extensions]\n\trefStorage = reftable\n')

    const included = join(root, 'included')
    await fileRepository(included, { origin: 'git@github.com:acme/i.git', head: 'ref: refs/heads/main' })
    await appendFile(join(included, '.git', 'config'), '[includeIf "gitdir:~/work/"]\n\tpath = work.gitconfig\n')
    const alias = join(root, 'alias')
    await fileRepository(alias, { origin: 'gh:acme/alias.git', head: 'ref: refs/heads/main' })

    expect(await readCheckout(pointer)).toBeNull()
    expect(await readCheckout(reftable)).toBeNull()
    expect(await readCheckout(included)).toBeNull()
    expect(await readCheckout(alias)).toBeNull()
  })

  test('an origin rewritten by insteadOf is resolved by git', async () => {
    const root = await tempRoot()
    const alias = join(root, 'acme', 'alias')
    await mkdir(alias, { recursive: true })
    await run('git', ['init', '-q', '-b', 'main'], alias)
    await run('git', ['remote', 'add', 'origin', 'gh:acme/alias.git'], alias)
    await appendFile(join(alias, '.git', 'config'), '[url "git@github.com:"]\n\tinsteadOf = gh:\n')

    const found = await discoverProjects([root])

    expect(found[0]).toMatchObject({ name: 'alias', repository: 'acme/alias', defaultBranch: 'main' })
  })

  test('finds the origin of a session started in a subdirectory or through a symlink without starting git', async () => {
    const fixtures = await gitFixtures()
    const nested = join(fixtures.worktree, 'src', 'deep')
    await mkdir(nested, { recursive: true })
    activeFake = fakeGit()

    const links = await tempRoot()
    await symlink(nested, join(links, 'deep'))

    expect(await gitOriginUrl(nested)).toBe('https://github.com/acme/demo.git')
    expect(await gitOriginUrl(join(links, 'deep'))).toBe('https://github.com/acme/demo.git')
    expect(await gitOriginUrl(fixtures.solo)).toBeNull()
    expect(activeFake.calls).toHaveLength(0)
  })

  test('reads the first origin url, in either section spelling', () => {
    const remoteUrl = projects.remoteUrl
    expect(typeof remoteUrl).toBe('function')
    expect(remoteUrl('[remote "upstream"]\n\turl = a\n[remote "origin"]\n\turl = b\n\turl = c\n', 'origin')).toBe('b')
    expect(remoteUrl('[remote.origin]\n\tURL = "x y" # note\n', 'origin')).toBe('x y')
    expect(remoteUrl('[remote "Origin"]\n\turl = a\n', 'origin')).toBeNull()
    expect(remoteUrl('[core]\n\tbare = false\n', 'origin')).toBeNull()
  })

  test('normalises common GitHub remote forms', () => {
    expect(normaliseGitHubRepository('git@github.com:lucharo/agent-zen.git')).toBe('lucharo/agent-zen')
    expect(normaliseGitHubRepository('https://github.com/lucharo/agent-zen.git')).toBe('lucharo/agent-zen')
    expect(normaliseGitHubRepository('ssh://git@example.com/lucharo/agent-zen.git')).toBeNull()
  })
})

async function tempRoot(owner = cleanup): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'agent-zen-projects-')))
  owner.push(root)
  return root
}

/** A checkout made of files alone, laid out as `git init` would leave it. */
async function fileRepository(
  directory: string,
  options: { origin?: string; head: string; remoteHead?: string },
): Promise<void> {
  const gitDir = join(directory, '.git')
  await mkdir(join(gitDir, 'objects'), { recursive: true })
  await mkdir(join(gitDir, 'refs', 'heads'), { recursive: true })
  await writeFile(join(gitDir, 'HEAD'), `${options.head}\n`)
  const remote = options.origin ? `[remote "origin"]\n\turl = ${options.origin}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n` : ''
  await writeFile(join(gitDir, 'config'), `[core]\n\trepositoryformatversion = 0\n\tbare = false\n${remote}`)
  if (options.remoteHead) {
    await mkdir(join(gitDir, 'refs', 'remotes', 'origin'), { recursive: true })
    await writeFile(join(gitDir, 'refs', 'remotes', 'origin', 'HEAD'), `${options.remoteHead}\n`)
  }
}

/** Built once per file: the tests only read these checkouts. */
function gitFixtures(): ReturnType<typeof buildGitFixtures> {
  sharedFixtures ??= buildGitFixtures()
  return sharedFixtures
}

/** Real checkouts made by git: packed refs, a worktree, a detached worktree, no origin, a moved git dir. */
async function buildGitFixtures(): Promise<Record<'root' | 'main' | 'worktree' | 'detached' | 'solo' | 'gitfile' | 'quoted', string>> {
  const root = await tempRoot(sharedCleanup)
  const main = join(root, 'acme', 'main')
  await mkdir(main, { recursive: true })
  await run('git', ['init', '-q', '-b', 'main'], main)
  await run('git', ['commit', '-q', '--allow-empty', '-m', 'start'], main)
  await run('git', ['remote', 'add', 'origin', 'https://github.com/acme/demo.git'], main)
  await run('git', ['update-ref', 'refs/remotes/origin/trunk', 'HEAD'], main)
  await run('git', ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk'], main)
  await run('git', ['pack-refs', '--all'], main)
  const worktree = join(root, 'acme', 'worktree')
  await run('git', ['worktree', 'add', '-q', '-b', 'feat', worktree], main)
  const detached = join(root, 'acme', 'detached')
  await run('git', ['worktree', 'add', '-q', '--detach', detached], main)

  const solo = join(root, 'acme', 'solo')
  await mkdir(solo, { recursive: true })
  await run('git', ['init', '-q', '-b', 'solo'], solo)

  // A `.git` file with a relative path, the shape submodules use.
  const gitfile = join(root, 'acme', 'gitfile')
  await mkdir(gitfile, { recursive: true })
  await run('git', ['init', '-q', '-b', 'main'], gitfile)
  await run('git', ['remote', 'add', 'origin', 'git@github.com:acme/moved.git'], gitfile)
  await mkdir(join(root, 'store'), { recursive: true })
  await rename(join(gitfile, '.git'), join(root, 'store', 'gitfile.git'))
  await writeFile(join(gitfile, '.git'), 'gitdir: ../../store/gitfile.git\n')

  const quoted = join(root, 'acme', 'quoted')
  await mkdir(quoted, { recursive: true })
  await run('git', ['init', '-q', '-b', 'main'], quoted)
  await appendFile(join(quoted, '.git', 'config'), '[remote "origin"] ; the hosted copy\n\turl = "git@github.com:acme/quoted.git" ; pushed here\n')

  return { root, main, worktree, detached, solo, gitfile, quoted }
}

async function gitView(directory: string): Promise<{ origin: string | null; remoteHead: string | null; branch: string | null }> {
  const [origin, remoteHead, branch] = await Promise.all([
    output(['remote', 'get-url', 'origin'], directory),
    output(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], directory),
    output(['branch', '--show-current'], directory),
  ])
  return { origin, remoteHead, branch }
}

/** Git with no user or system config, so the fixtures do not depend on this machine. */
const isolatedGitEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
}

async function output(args: string[], cwd: string): Promise<string | null> {
  const child = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'ignore', env: isolatedGitEnv })
  const [exitCode, stdout] = await Promise.all([child.exited, new Response(child.stdout).text()])
  return exitCode === 0 ? stdout.trim() || null : null
}

async function run(command: string, args: string[], cwd: string): Promise<void> {
  const child = Bun.spawn([command, ...args], { cwd, stdout: 'pipe', stderr: 'pipe', env: isolatedGitEnv })
  const exitCode = await child.exited
  if (exitCode !== 0) throw new Error(`${command} ${args.join(' ')} failed with exit code ${exitCode}`)
}

async function waitUntil(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for the condition.')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}
