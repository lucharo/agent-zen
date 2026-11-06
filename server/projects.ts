import { createHash } from 'node:crypto'
import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import type { ProjectCandidate } from '../src/adapters/ProjectDiscoverySource'

const SKIP = new Set(['.git', '.codex', '.claude', 'node_modules', 'dist'])

/**
 * The most `git` processes discovery may run at once, used only for checkouts
 * whose files cannot be read directly. Every process start is costly on a Mac
 * whose endpoint security software inspects each one; an unbounded round over
 * about 90 repositories once held hundreds of `git` processes and pushed the
 * load average past 400. Four keeps the rare fallback far below the core count.
 */
export const GIT_FALLBACK_CONCURRENCY = 4

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
  const checkout = await readCheckout(directory) ?? await readCheckoutWithGit(directory)
  const repository = normaliseGitHubRepository(checkout.origin)
  const defaultBranch = checkout.remoteHead?.replace(/^origin\//, '') || checkout.branch || null
  return {
    id: `project-${createHash('sha256').update(directory).digest('hex').slice(0, 12)}`,
    name: basename(directory),
    directory,
    repository,
    defaultBranch,
  }
}

/** What discovery needs from a checkout, in the shapes the matching `git` commands print. */
export interface CheckoutInfo {
  /** `git remote get-url origin` */
  readonly origin: string | null
  /** `git symbolic-ref --quiet --short refs/remotes/origin/HEAD`, e.g. `origin/main` */
  readonly remoteHead: string | null
  /** `git branch --show-current`; null on a detached HEAD */
  readonly branch: string | null
}

/**
 * Reads a checkout's branch, origin URL and origin's default branch from its
 * files, without starting a process. `.git` may be a directory or a file
 * holding `gitdir: <path>` (worktrees, submodules); a worktree keeps its config
 * and remote refs in the common directory named by `commondir`. Returns null
 * when the files cannot be read with confidence (an unknown HEAD, reftable,
 * config includes or worktree config, an origin that is not a GitHub address and
 * may be rewritten by `insteadOf`), so the caller can ask git.
 */
export async function readCheckout(directory: string): Promise<CheckoutInfo | null> {
  const gitDir = await resolveGitDir(directory)
  if (!gitDir) return null
  const head = await readText(join(gitDir, 'HEAD'))
  if (head === null) return null
  const branch = headBranch(head)
  if (branch === undefined) return null
  const commonDir = await resolveCommonDir(gitDir)
  const config = await readText(join(commonDir, 'config'))
  if (config === null || usesReftable(config) || layersConfig(config)) return null
  if (usesWorktreeConfig(config) && await readText(join(gitDir, 'config.worktree')) !== null) return null
  const origin = remoteUrl(config, 'origin')
  // A raw url that is not a GitHub address may be an alias that an `insteadOf`
  // rule (possibly in the user's config) rewrites, so only git knows its value.
  if (origin !== null && normaliseGitHubRepository(origin) === null) return null
  // A symbolic ref is always a loose file: packed-refs only ever holds refs that
  // point at objects, which `git symbolic-ref` would not report either.
  const remoteHeadRef = await readText(join(commonDir, 'refs', 'remotes', 'origin', 'HEAD'))
  const remoteHeadTarget = remoteHeadRef?.match(/^ref:\s*(\S+)\s*$/)?.[1] ?? null
  return {
    origin,
    remoteHead: remoteHeadTarget ? shortRefName(remoteHeadTarget) : null,
    branch,
  }
}

/** The `origin` remote of the checkout containing `directory`, or null outside git. */
export async function gitOriginUrl(directory: string): Promise<string | null> {
  const checkoutRoot = await findCheckoutRoot(directory)
  if (!checkoutRoot) return null
  const checkout = await readCheckout(checkoutRoot)
  if (checkout) return checkout.origin
  return git(directory, ['remote', 'get-url', 'origin'])
}

async function readCheckoutWithGit(directory: string): Promise<CheckoutInfo> {
  const [origin, remoteHead, branch] = await Promise.all([
    git(directory, ['remote', 'get-url', 'origin']),
    git(directory, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']),
    git(directory, ['branch', '--show-current']),
  ])
  return { origin, remoteHead, branch }
}

async function findCheckoutRoot(directory: string): Promise<string | null> {
  // git resolves symlinks before looking for `.git`; a lexical walk would miss the checkout.
  let current = await realpath(directory).catch(() => resolve(directory))
  while (true) {
    if (await isGitCheckout(current)) return current
    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
}

async function resolveGitDir(directory: string): Promise<string | null> {
  const dotGit = join(directory, '.git')
  const info = await stat(dotGit).catch(() => null)
  if (!info) return null
  if (info.isDirectory()) return dotGit
  if (!info.isFile()) return null
  const pointer = (await readText(dotGit))?.match(/^gitdir:\s*(.+?)\s*$/m)?.[1]
  if (!pointer) return null
  const gitDir = isAbsolute(pointer) ? pointer : resolve(directory, pointer)
  const target = await stat(gitDir).catch(() => null)
  return target?.isDirectory() ? gitDir : null
}

async function resolveCommonDir(gitDir: string): Promise<string> {
  const pointer = (await readText(join(gitDir, 'commondir')))?.trim()
  if (!pointer) return gitDir
  return isAbsolute(pointer) ? pointer : resolve(gitDir, pointer)
}

/** The branch HEAD is on, null when detached, undefined when HEAD is not understood. */
function headBranch(head: string): string | null | undefined {
  const trimmed = head.trim()
  const symbolic = trimmed.match(/^ref:\s*(\S+)$/)?.[1]
  if (symbolic) {
    if (!symbolic.startsWith('refs/heads/')) return undefined
    const name = symbolic.slice('refs/heads/'.length)
    // Reftable repositories leave a placeholder HEAD that names no real branch.
    return name && name !== '.invalid' ? name : undefined
  }
  return /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/i.test(trimmed) ? null : undefined
}

function shortRefName(ref: string): string {
  return ref.replace(/^refs\/(?:heads|tags|remotes)\//, '').replace(/^refs\//, '')
}

/** `include` and `includeIf` pull in config this reader does not follow. */
function layersConfig(config: string): boolean {
  return /^\s*\[\s*include(?:if)?\b/im.test(config)
}

function usesWorktreeConfig(config: string): boolean {
  return /^\s*worktreeconfig\s*=\s*"?(?:true|yes|on|1)"?\s*$/im.test(config)
}

function usesReftable(config: string): boolean {
  return /^\s*refstorage\s*=\s*"?reftable"?\s*$/im.test(config)
}

/** The first `url` of `[remote "<name>"]`, as `git remote get-url` prints it. */
export function remoteUrl(config: string, name: string): string | null {
  let inRemote = false
  for (const rawLine of config.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || line.startsWith(';')) continue
    const section = line.match(/^\[\s*([A-Za-z0-9.-]+)(?:\s+"((?:[^"\\]|\\.)*)")?\s*\]\s*(.*)$/)
    if (section) {
      const [sectionName, legacySubsection] = section[1]!.split(/\.(.*)/s)
      // `[remote.origin]` is git's older spelling of `[remote "origin"]`, with the name lowercased.
      const subsection = unescapeSubsection(section[2]) ?? legacySubsection?.toLowerCase() ?? null
      inRemote = sectionName!.toLowerCase() === 'remote' && subsection === name
      if (!inRemote || !section[3]) continue
      const value = keyValue(section[3], 'url')
      if (value !== null) return value
      continue
    }
    if (!inRemote) continue
    const value = keyValue(line, 'url')
    if (value !== null) return value
  }
  return null
}

function unescapeSubsection(value: string | undefined): string | null {
  return value === undefined ? null : value.replace(/\\(.)/g, '$1')
}

function keyValue(line: string, key: string): string | null {
  const match = line.match(/^([A-Za-z][A-Za-z0-9-]*)\s*=\s*(.*)$/)
  if (!match || match[1]!.toLowerCase() !== key) return null
  const value = configValue(match[2]!)
  return value || null
}

/** A git config value: quotes removed, escapes resolved, trailing comments dropped. */
function configValue(raw: string): string {
  let value = ''
  let quoted = false
  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index]!
    if (character === '\\' && index + 1 < raw.length) {
      const next = raw[++index]!
      value += next === 'n' ? '\n' : next === 't' ? '\t' : next === 'b' ? '\b' : next
      continue
    }
    if (character === '"') {
      quoted = !quoted
      continue
    }
    if (!quoted && (character === '#' || character === ';')) break
    value += character
  }
  return value.trim()
}

async function readText(path: string): Promise<string | null> {
  return readFile(path, 'utf8').catch(() => null)
}

let runningGit = 0
const waitingGit: Array<() => void> = []

async function git(directory: string, args: readonly string[]): Promise<string | null> {
  if (runningGit >= GIT_FALLBACK_CONCURRENCY) {
    await new Promise<void>((resolveSlot) => waitingGit.push(resolveSlot))
  } else {
    runningGit += 1
  }
  try {
    const process = Bun.spawn(['git', '-C', directory, ...args], {
      stdout: 'pipe',
      stderr: 'ignore',
    })
    const [exitCode, stdout] = await Promise.all([process.exited, new Response(process.stdout).text()])
    if (exitCode !== 0) return null
    return stdout.trim() || null
  } catch {
    return null
  } finally {
    // Hand the slot straight to the next waiter, so the count never dips and refills.
    const next = waitingGit.shift()
    if (next) next()
    else runningGit -= 1
  }
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
