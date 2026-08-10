#!/usr/bin/env bun

import { access, mkdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import packageJson from '../package.json'
import {
  DAEMON_LABEL,
  DAEMON_STOP_TIMEOUT_MS,
  defaultDaemonPaths,
  hasManagedDaemonStopped,
  parseDaemonHealth,
  parseLaunchAtLoginEnabled,
  parseLogLineCount,
  parseLaunchctlPrint,
  renderLaunchAgent,
  waitUntil,
  type DaemonPaths,
  type DaemonHealth,
  type LaunchctlState,
} from './daemon'

const DEFAULT_PORT = 5274

interface Runtime {
  readonly paths: DaemonPaths
  readonly port: number
  readonly url: string
  readonly healthUrl: string
  readonly domain: string
  readonly target: string
  readonly codexPath: string
  readonly path: string
}

interface CommandResult {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

interface DaemonStatus extends LaunchctlState {
  readonly healthy: boolean
  readonly reachable: boolean
  readonly serverPid: number | null
  readonly version: string | null
  readonly codexConnected: boolean
  readonly url: string
  readonly launchAtLogin: boolean
  readonly plistPath: string
  readonly logPath: string
}

async function main(args: readonly string[]): Promise<void> {
  const [command, ...rest] = args
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printHelp()
    return
  }
  if (command === 'version' || command === '--version' || command === '-v') {
    console.log(`agent-zen ${packageJson.version}`)
    return
  }
  if (command === 'open') {
    await openApp()
    return
  }
  if (command !== 'daemon') throw new Error(`Unknown command: ${command}`)
  await daemonCommand(rest)
}

async function daemonCommand(args: readonly string[]): Promise<void> {
  const [command, ...rest] = args
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printDaemonHelp()
    return
  }
  switch (command) {
    case 'start':
      requireNoArgs(command, rest)
      await startDaemon(true)
      return
    case 'status':
      requireKnownFlags(command, rest, ['--json'])
      await printStatus(rest.includes('--json'))
      return
    case 'stop':
      requireNoArgs(command, rest)
      await stopDaemon(true)
      return
    case 'restart':
      requireNoArgs(command, rest)
      await restartDaemon()
      return
    case 'logs':
      await showLogs(rest)
      return
    case 'run':
      requireNoArgs(command, rest)
      await runForeground()
      return
    default:
      throw new Error(`Unknown daemon command: ${command}`)
  }
}

async function runtime(): Promise<Runtime> {
  const home = homedir()
  const port = positiveInteger(process.env.AGENT_ZEN_PORT, DEFAULT_PORT)
  const paths = defaultDaemonPaths({
    home,
    executablePath: process.execPath,
    prefix: process.env.AGENT_ZEN_PREFIX,
  })
  const overriddenPaths: DaemonPaths = {
    ...paths,
    serverPath: resolve(process.env.AGENT_ZEN_SERVER_PATH ?? paths.serverPath),
    distDirectory: resolve(process.env.AGENT_ZEN_DIST_DIR ?? paths.distDirectory),
  }
  const codexPath = process.env.AGENT_ZEN_CODEX_PATH
    ?? await findExecutable('codex').catch(() => 'codex')
  const path = unique([
    codexPath.includes('/') ? dirname(codexPath) : '',
    dirname(overriddenPaths.cliPath),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
  ]).join(':')
  const domain = `gui/${process.getuid?.() ?? 0}`
  return {
    paths: overriddenPaths,
    port,
    url: `http://localhost:${port}/`,
    healthUrl: `http://127.0.0.1:${port}/api/health`,
    domain,
    target: `${domain}/${DAEMON_LABEL}`,
    codexPath,
    path,
  }
}

async function startDaemon(report: boolean): Promise<void> {
  const current = await runtime()
  await assertInstalledAssets(current)
  const launchd = await launchctlState(current)
  const health = await daemonHealth(current)
  if (isOwnedHealthy(launchd, health)) {
    if (report) printRunning(current, launchd.pid, 'already running')
    return
  }
  assertNoUnmanagedServer(current, launchd, health)

  await writeLaunchAgent(current)
  await checked(['/bin/launchctl', 'enable', current.target])
  if (launchd.loaded) {
    await checked(['/bin/launchctl', 'bootout', current.target])
    await waitUntil(
      async () => {
        const [nextLaunchd, nextHealth] = await Promise.all([
          launchctlState(current),
          daemonHealth(current),
        ])
        return hasManagedDaemonStopped(nextLaunchd, nextHealth, launchd.pid)
      },
      { timeoutMs: DAEMON_STOP_TIMEOUT_MS, message: 'Agent Zen did not stop before restart' },
    )
  }
  await checked(['/bin/launchctl', 'bootstrap', current.domain, current.paths.plistPath])
  try {
    await waitUntil(
      async () => {
        const [nextLaunchd, nextHealth] = await Promise.all([
          launchctlState(current),
          daemonHealth(current),
        ])
        return isOwnedHealthy(nextLaunchd, nextHealth)
      },
      { timeoutMs: 10_000, message: 'Agent Zen did not become healthy' },
    )
  } catch (error) {
    await run(['/bin/launchctl', 'bootout', current.target])
    await run(['/bin/launchctl', 'disable', current.target])
    throw error
  }
  const started = await launchctlState(current)
  if (report) printRunning(current, started.pid, 'started')
}

async function stopDaemon(report: boolean): Promise<void> {
  const current = await runtime()
  const launchd = await launchctlState(current)
  const initialHealth = await daemonHealth(current)
  if (!launchd.loaded && initialHealth.reachable) {
    await checked(['/bin/launchctl', 'disable', current.target])
    throw unmanagedServerError(current, launchd, initialHealth)
  }
  if (launchd.loaded) {
    await checked(['/bin/launchctl', 'bootout', current.target])
    await waitUntil(
      async () => {
        const [nextLaunchd, nextHealth] = await Promise.all([
          launchctlState(current),
          daemonHealth(current),
        ])
        return hasManagedDaemonStopped(nextLaunchd, nextHealth, launchd.pid)
      },
      { timeoutMs: DAEMON_STOP_TIMEOUT_MS, message: 'Agent Zen did not stop' },
    )
  }
  await checked(['/bin/launchctl', 'disable', current.target])
  const finalHealth = await daemonHealth(current)
  if (finalHealth.reachable) throw unmanagedServerError(current, launchd, finalHealth)
  if (report) {
    console.log(launchd.loaded ? 'Agent Zen daemon stopped' : 'Agent Zen daemon was not running')
  }
}

async function restartDaemon(): Promise<void> {
  const current = await runtime()
  const launchd = await launchctlState(current)
  if (launchd.loaded) await stopDaemon(false)
  await startDaemon(false)
  const started = await launchctlState(current)
  printRunning(current, started.pid, launchd.loaded ? 'restarted' : 'started')
}

async function printStatus(asJson: boolean): Promise<void> {
  const current = await runtime()
  const launchd = await launchctlState(current)
  const health = await daemonHealth(current)
  const healthy = isOwnedHealthy(launchd, health)
  const status: DaemonStatus = {
    ...launchd,
    healthy,
    reachable: health.reachable,
    serverPid: health.pid,
    version: health.version,
    codexConnected: health.codexConnected,
    url: current.url,
    launchAtLogin: launchd.loaded || await launchAtLoginEnabled(current),
    plistPath: current.paths.plistPath,
    logPath: current.paths.logPath,
  }
  if (asJson) {
    console.log(JSON.stringify(status, null, 2))
    return
  }
  const state = status.healthy
    ? 'running'
    : status.loaded && status.reachable
      ? 'port served by another process'
    : status.reachable
      ? 'running outside launchd'
      : status.loaded
        ? 'loaded but unhealthy'
        : 'stopped'
  console.log(`Agent Zen daemon: ${state}`)
  if (status.pid) console.log(`PID: ${status.pid}`)
  if (status.serverPid && status.serverPid !== status.pid) console.log(`Serving PID: ${status.serverPid}`)
  console.log(`URL: ${status.url}`)
  if (status.reachable) console.log(`Codex: ${status.codexConnected ? 'connected' : 'unavailable'}`)
  console.log(`Launch at login: ${status.launchAtLogin ? 'enabled' : 'disabled'}`)
  console.log(`Log: ${status.logPath}`)
}

async function openApp(): Promise<void> {
  const current = await runtime()
  const [launchd, health] = await Promise.all([launchctlState(current), daemonHealth(current)])
  if (!isOwnedHealthy(launchd, health)) await startDaemon(false)
  await checked(['/usr/bin/open', current.url])
  console.log(current.url)
}

async function showLogs(args: readonly string[]): Promise<void> {
  requireKnownFlags('logs', args, ['--follow', '-f', '--lines'])
  const current = await runtime()
  const follow = args.includes('--follow') || args.includes('-f')
  const lines = parseLogLineCount(args)
  if (!(await exists(current.paths.logPath))) {
    console.log(`No daemon log yet: ${current.paths.logPath}`)
    return
  }
  const tailArgs = ['-n', String(lines)]
  if (follow) tailArgs.push('-f')
  const child = Bun.spawn(['/usr/bin/tail', ...tailArgs, current.paths.logPath], {
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  })
  process.exitCode = await child.exited
}

async function runForeground(): Promise<void> {
  const current = await runtime()
  await assertInstalledAssets(current)
  const child = Bun.spawn([current.paths.serverPath], {
    env: {
      ...process.env,
      HOME: homedir(),
      PATH: current.path,
      AGENT_ZEN_PORT: String(current.port),
      AGENT_ZEN_DIST_DIR: current.paths.distDirectory,
      AGENT_ZEN_CODEX_PATH: current.codexPath,
    },
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const interrupt = () => child.kill('SIGINT')
  const terminate = () => child.kill('SIGTERM')
  process.once('SIGINT', interrupt)
  process.once('SIGTERM', terminate)
  try {
    process.exitCode = await child.exited
  } finally {
    process.off('SIGINT', interrupt)
    process.off('SIGTERM', terminate)
  }
}

async function writeLaunchAgent(current: Runtime): Promise<void> {
  await mkdir(current.paths.dataDirectory, { recursive: true, mode: 0o700 })
  await mkdir(dirname(current.paths.plistPath), { recursive: true })
  const temporary = `${current.paths.plistPath}.tmp-${process.pid}`
  const plist = renderLaunchAgent(current.paths, {
    codexPath: current.codexPath,
    port: current.port,
    path: current.path,
  })
  await writeFile(temporary, plist, { mode: 0o644 })
  try {
    await checked(['/usr/bin/plutil', '-lint', temporary])
    await rename(temporary, current.paths.plistPath)
  } catch (error) {
    await unlink(temporary).catch(() => undefined)
    throw error
  }
}

async function launchctlState(current: Runtime): Promise<LaunchctlState> {
  const result = await run(['/bin/launchctl', 'print', current.target])
  return parseLaunchctlPrint(result.stdout, result.code === 0)
}

async function launchAtLoginEnabled(current: Runtime): Promise<boolean> {
  if (!(await exists(current.paths.plistPath))) return false
  const result = await run(['/bin/launchctl', 'print-disabled', current.domain])
  if (result.code !== 0) return false
  return parseLaunchAtLoginEnabled(result.stdout, DAEMON_LABEL)
}

async function daemonHealth(current: Runtime): Promise<DaemonHealth> {
  try {
    const response = await fetch(current.healthUrl, { signal: AbortSignal.timeout(1_000) })
    if (!response.ok) return parseDaemonHealth(null)
    return parseDaemonHealth(await response.json())
  } catch {
    return parseDaemonHealth(null)
  }
}

function isOwnedHealthy(launchd: LaunchctlState, health: DaemonHealth): boolean {
  return Boolean(
    launchd.loaded
    && launchd.pid
    && health.reachable
    && health.pid === launchd.pid,
  )
}

function assertNoUnmanagedServer(
  current: Runtime,
  launchd: LaunchctlState,
  health: DaemonHealth,
): void {
  if (health.reachable && health.pid !== launchd.pid) {
    throw unmanagedServerError(current, launchd, health)
  }
}

function unmanagedServerError(
  current: Runtime,
  launchd: LaunchctlState,
  health: DaemonHealth,
): Error {
  const server = health.pid ? `process ${health.pid}` : 'another process'
  const managed = launchd.pid ? `; launchd owns process ${launchd.pid}` : ''
  return new Error(
    `Agent Zen is being served by unmanaged ${server} at ${current.url}${managed}. Stop that process before managing the daemon.`,
  )
}

async function assertInstalledAssets(current: Runtime): Promise<void> {
  if (!(await executable(current.paths.serverPath))) {
    throw new Error(`Agent Zen server is not installed at ${current.paths.serverPath}. Run bun run install:cli from the repository.`)
  }
  if (!(await exists(join(current.paths.distDirectory, 'index.html')))) {
    throw new Error(`Agent Zen web assets are not installed at ${current.paths.distDirectory}. Run bun run install:cli from the repository.`)
  }
}

async function findExecutable(name: string): Promise<string> {
  for (const directory of (process.env.PATH ?? '').split(':').filter(Boolean)) {
    const candidate = join(directory, name)
    if (await executable(candidate)) return resolve(candidate)
  }
  throw new Error(`${name} is not available on PATH`)
}

async function executable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function checked(command: readonly string[]): Promise<CommandResult> {
  const result = await run(command)
  if (result.code !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`
    throw new Error(`${command.join(' ')}: ${detail}`)
  }
  return result
}

async function run(command: readonly string[]): Promise<CommandResult> {
  const child = Bun.spawn([...command], { stdout: 'pipe', stderr: 'pipe' })
  const stdout = new Response(child.stdout).text()
  const stderr = new Response(child.stderr).text()
  const code = await child.exited
  return { code, stdout: await stdout, stderr: await stderr }
}

function printRunning(current: Runtime, pid: number | null, verb: string): void {
  console.log(`Agent Zen daemon ${verb}${pid ? ` (pid ${pid})` : ''}`)
  console.log(current.url)
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function requireNoArgs(command: string, args: readonly string[]): void {
  if (args.length > 0) throw new Error(`daemon ${command} does not accept arguments`)
}

function requireKnownFlags(command: string, args: readonly string[], allowed: readonly string[]): void {
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (!argument || !allowed.includes(argument)) throw new Error(`Unknown daemon ${command} option: ${argument}`)
    if (argument === '--lines') index += 1
  }
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

function printHelp(): void {
  console.log(`Agent Zen ${packageJson.version} - a calm local board for Codex sessions

Usage:
  agent-zen <command>

Commands:
  open       Start the daemon if needed and open Agent Zen
  daemon     Manage the background service
  version    Print version information
  help       Show this help`)
}

function printDaemonHelp(): void {
  console.log(`Manage the Agent Zen background service

Usage:
  agent-zen daemon <command>

Commands:
  start      Install and start the launch-at-login service
  status     Show service and HTTP health (--json for JSON)
  restart    Restart the service after an upgrade or configuration change
  stop       Stop and disable the service
  logs       Show recent logs (--follow, --lines N)
  run        Run the installed server in the foreground`)
}

await main(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
