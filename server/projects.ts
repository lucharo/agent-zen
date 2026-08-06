import { createHash } from 'node:crypto'
import { readdir, realpath, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { ProjectCandidate } from '../src/adapters/ProjectDiscoverySource'

const SKIP = new Set(['.git', '.codex', '.claude', 'node_modules', 'dist'])

export async function discoverProjects(roots: readonly string[]): Promise<ProjectCandidate[]> {
  const discovered = new Map<string, ProjectCandidate>()
  for (const root of roots) {
    const canonicalRoot = await realpath(root).catch(() => null)
    if (!canonicalRoot) continue
    await walk(canonicalRoot, 2, discovered)
  }
  return [...discovered.values()].sort((left, right) =>
    (left.repository ?? left.directory).localeCompare(right.repository ?? right.directory),
  )
}

async function walk(
  directory: string,
  depth: number,
  discovered: Map<string, ProjectCandidate>,
): Promise<void> {
  if (await isGitCheckout(directory)) {
    const candidate = await describeProject(directory)
    discovered.set(candidate.directory, candidate)
    return
  }
  if (depth === 0) return

  const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && !SKIP.has(entry.name))
      .map((entry) => walk(join(directory, entry.name), depth - 1, discovered)),
  )
}

async function isGitCheckout(directory: string): Promise<boolean> {
  return stat(join(directory, '.git'))
    .then((value) => value.isDirectory() || value.isFile())
    .catch(() => false)
}

async function describeProject(directory: string): Promise<ProjectCandidate> {
  const [origin, remoteHead, branch] = await Promise.all([
    git(directory, ['remote', 'get-url', 'origin']),
    git(directory, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']),
    git(directory, ['branch', '--show-current']),
  ])
  const repository = normaliseGitHubRepository(origin)
  const defaultBranch = remoteHead?.replace(/^origin\//, '') || branch || null
  return {
    id: `project-${createHash('sha256').update(directory).digest('hex').slice(0, 12)}`,
    name: basename(directory),
    directory,
    repository,
    defaultBranch,
  }
}

async function git(directory: string, args: readonly string[]): Promise<string | null> {
  const process = Bun.spawn(['git', '-C', directory, ...args], {
    stdout: 'pipe',
    stderr: 'ignore',
  })
  const [exitCode, stdout] = await Promise.all([process.exited, new Response(process.stdout).text()])
  if (exitCode !== 0) return null
  return stdout.trim() || null
}

export function normaliseGitHubRepository(remote: string | null): string | null {
  if (!remote) return null
  const scp = remote.match(/^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/i)
  if (scp?.[1]) return scp[1].replace(/\.git$/i, '')

  try {
    const url = new URL(remote)
    if (url.hostname.toLowerCase() !== 'github.com') return null
    const repository = url.pathname.replace(/^\//, '').replace(/\.git$/i, '')
    return /^[^/]+\/[^/]+$/.test(repository) ? repository : null
  } catch {
    return null
  }
}
