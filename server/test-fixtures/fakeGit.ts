import { spyOn } from 'bun:test'

export interface FakeGitCall {
  readonly args: readonly string[]
}

export interface FakeGit {
  readonly calls: FakeGitCall[]
  /** The most fake `git` processes alive at the same moment. */
  readonly maxLive: () => number
  readonly live: () => number
  /** Lets every held process exit; later ones exit at once. */
  readonly release: () => void
  readonly restore: () => void
}

/**
 * Replaces every `git` process the code under test would start with an
 * in-memory stand-in, so tests can count starts and concurrency without
 * starting processes. Other commands still run for real.
 */
export function fakeGit(options: { hold?: boolean; exitAfterMs?: number } = {}): FakeGit {
  const original = Bun.spawn
  const calls: FakeGitCall[] = []
  const held: Array<() => void> = []
  let releaseAll = !options.hold
  let live = 0
  let maxLive = 0
  const spy = spyOn(Bun, 'spawn').mockImplementation(((command: unknown, ...rest: unknown[]) => {
    const argv = Array.isArray(command)
      ? command as string[]
      : (command as { cmd: string[] }).cmd
    if (argv[0] !== 'git') return (original as (...args: unknown[]) => unknown)(command, ...rest)
    calls.push({ args: argv.slice(1) })
    live += 1
    maxLive = Math.max(maxLive, live)
    const exited = new Promise<number>((resolve) => {
      const finish = () => setTimeout(() => {
        live -= 1
        resolve(1)
      }, options.exitAfterMs ?? 0)
      if (releaseAll) finish()
      else held.push(finish)
    })
    return { exited, stdout: new Blob([]).stream(), pid: 0, kill() {} }
  }) as typeof Bun.spawn)
  return {
    calls,
    maxLive: () => maxLive,
    live: () => live,
    release() {
      releaseAll = true
      for (const finish of held.splice(0)) finish()
    },
    restore: () => spy.mockRestore(),
  }
}
