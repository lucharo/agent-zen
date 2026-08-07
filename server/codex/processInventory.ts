const THREAD_ID_IN_ROLLOUT = /\/sessions\/\d{4}\/\d{2}\/\d{2}\/rollout-[^/]*-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i

/**
 * Return the Codex thread ids whose rollout files are held open by a live
 * `codex` process. `null` means process discovery itself was unavailable;
 * an empty set means discovery worked and no live Codex sessions were found.
 */
export async function discoverActiveCodexThreadIds(): Promise<ReadonlySet<string> | null> {
  const executable = process.platform === 'darwin' ? '/usr/sbin/lsof' : 'lsof'
  try {
    const child = Bun.spawn([executable, '-nP', '-c', 'codex', '-c', 'Codex', '-F', 'pcnf'], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const outputPromise = new Response(child.stdout).text()
    const errorPromise = new Response(child.stderr).text()
    const exitCode = await child.exited
    const [output, error] = await Promise.all([outputPromise, errorPromise])
    if (exitCode !== 0 && !(exitCode === 1 && error.trim() === '')) return null
    return parseActiveCodexThreadIds(output)
  } catch {
    return null
  }
}

export function parseActiveCodexThreadIds(output: string): ReadonlySet<string> | null {
  const ids = new Set<string>()
  let command: string | null = null
  let sawCodexProcess = false

  for (const line of output.split('\n')) {
    const field = line[0]
    if (field === 'p') {
      command = null
      continue
    }
    if (field === 'c') {
      command = line.slice(1)
      sawCodexProcess ||= isCodexCommand(command)
      continue
    }
    if (field !== 'n' || !isCodexCommand(command)) continue
    const match = line.slice(1).match(THREAD_ID_IN_ROLLOUT)
    if (match?.[1]) ids.add(match[1])
  }

  if (output.trim() && !sawCodexProcess) return null
  return new Set([...ids].sort())
}

function isCodexCommand(command: string | null): boolean {
  return command?.toLowerCase() === 'codex' || command?.toLowerCase().startsWith('codex-') === true
}
