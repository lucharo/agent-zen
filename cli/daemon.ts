import { dirname, join, resolve } from 'node:path'
import { BRIDGE_PROTOCOL_VERSION } from '../src/bridge/types'

export const DAEMON_LABEL = 'io.lucharo.agent-zen'
export const DAEMON_START_TIMEOUT_MS = 20_000
export const DAEMON_STOP_TIMEOUT_MS = 15_000

export interface DaemonPaths {
  readonly cliPath: string
  readonly serverPath: string
  readonly distDirectory: string
  readonly dataDirectory: string
  readonly logPath: string
  readonly plistPath: string
}

export interface LaunchAgentOptions {
  readonly codexPath: string
  readonly port: number
  readonly path: string
}

export interface LaunchctlState {
  readonly loaded: boolean
  readonly state: string | null
  readonly pid: number | null
}

export interface DaemonHealth {
  readonly reachable: boolean
  readonly pid: number | null
  readonly version: string | null
  readonly protocolVersion: number | null
  readonly codexConnected: boolean
  readonly claudeConnected: boolean
}

export interface LaunchAtLoginState {
  readonly plistExists: boolean
  readonly overrideEnabled: boolean
}

export interface WaitUntilOptions {
  readonly timeoutMs: number
  readonly intervalMs?: number
  readonly message: string
  readonly now?: () => number
  readonly sleep?: (milliseconds: number) => Promise<void>
}

export function defaultDaemonPaths(options: {
  readonly home: string
  readonly executablePath: string
  readonly prefix?: string
}): DaemonPaths {
  const cliPath = resolve(options.executablePath)
  const prefix = resolve(options.prefix ?? dirname(dirname(cliPath)))
  return {
    cliPath,
    serverPath: join(prefix, 'libexec', 'agent-zen', 'agent-zen-server'),
    distDirectory: join(prefix, 'share', 'agent-zen', 'dist'),
    dataDirectory: join(options.home, '.agent-zen'),
    logPath: join(options.home, '.agent-zen', 'daemon.log'),
    plistPath: join(options.home, 'Library', 'LaunchAgents', `${DAEMON_LABEL}.plist`),
  }
}

export function renderLaunchAgent(paths: DaemonPaths, options: LaunchAgentOptions): string {
  const values = {
    label: xml(DAEMON_LABEL),
    serverPath: xml(paths.serverPath),
    dataDirectory: xml(paths.dataDirectory),
    logPath: xml(paths.logPath),
    home: xml(dirname(paths.dataDirectory)),
    path: xml(options.path),
    port: xml(String(options.port)),
    distDirectory: xml(paths.distDirectory),
    codexPath: xml(options.codexPath),
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${values.label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${values.serverPath}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${values.dataDirectory}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>${values.home}</string>
    <key>PATH</key>
    <string>${values.path}</string>
    <key>AGENT_ZEN_PORT</key>
    <string>${values.port}</string>
    <key>AGENT_ZEN_DIST_DIR</key>
    <string>${values.distDirectory}</string>
    <key>AGENT_ZEN_CODEX_PATH</key>
    <string>${values.codexPath}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>5</integer>
  <key>StandardOutPath</key>
  <string>${values.logPath}</string>
  <key>StandardErrorPath</key>
  <string>${values.logPath}</string>
</dict>
</plist>
`
}

export function parseLaunchctlPrint(output: string, loaded = true): LaunchctlState {
  if (!loaded) return { loaded: false, state: null, pid: null }
  const state = output.match(/^\s*state = (.+)$/m)?.[1]?.trim() ?? null
  const rawPid = output.match(/^\s*pid = (\d+)$/m)?.[1]
  return { loaded: true, state, pid: rawPid ? Number(rawPid) : null }
}

export function parseDaemonHealth(value: unknown): DaemonHealth {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return unreachableHealth()
  const object = value as Record<string, unknown>
  const runtime = object.runtime
  const connection = object.connection
  if (
    typeof object.generatedAt !== 'string'
    || !runtime
    || typeof runtime !== 'object'
    || Array.isArray(runtime)
  ) return unreachableHealth()
  const runtimeObject = runtime as Record<string, unknown>
  if (!Number.isInteger(runtimeObject.pid) || Number(runtimeObject.pid) <= 0) {
    return unreachableHealth()
  }
  const connected = Boolean(
    connection
    && typeof connection === 'object'
    && !Array.isArray(connection)
    && (connection as Record<string, unknown>).connected === true,
  )
  return {
    reachable: true,
    pid: Number(runtimeObject.pid),
    version: typeof runtimeObject.version === 'string' ? runtimeObject.version : null,
    protocolVersion: Number.isInteger(object.protocolVersion) ? Number(object.protocolVersion) : null,
    codexConnected: backendConnected(object.backends, 'codex', connected),
    claudeConnected: backendConnected(object.backends, 'claude', false),
  }
}

function backendConnected(backends: unknown, agent: string, fallback: boolean): boolean {
  if (!Array.isArray(backends)) return fallback
  const match = backends.find((entry) =>
    entry && typeof entry === 'object' && (entry as Record<string, unknown>).agent === agent,
  ) as Record<string, unknown> | undefined
  return match ? match.connected === true : fallback
}

export function parseLogLineCount(args: readonly string[]): number {
  const index = args.indexOf('--lines')
  if (index === -1) return 80
  const value = args[index + 1]
  const parsed = Number(value)
  if (!value || !Number.isInteger(parsed) || parsed <= 0) {
    throw new Error('daemon logs --lines requires a positive integer')
  }
  return parsed
}

export function parseLaunchAtLoginEnabled(output: string, label: string): boolean {
  const match = output.match(new RegExp(`"${escapeRegex(label)}"\\s*=>\\s*(enabled|disabled)`))
  return match?.[1] !== 'disabled'
}

export function isLaunchAtLoginConfigured(state: LaunchAtLoginState): boolean {
  return state.plistExists && state.overrideEnabled
}

export function isOwnedHealthy(launchd: LaunchctlState, health: DaemonHealth): boolean {
  return Boolean(
    launchd.loaded
    && launchd.pid
    && health.reachable
    && health.pid === launchd.pid
    && health.protocolVersion === BRIDGE_PROTOCOL_VERSION
  )
}

export function canReuseHealthyDaemon(
  launchd: LaunchctlState,
  health: DaemonHealth,
  launchAtLogin: LaunchAtLoginState,
): boolean {
  return isOwnedHealthy(launchd, health) && isLaunchAtLoginConfigured(launchAtLogin)
}

export async function waitUntil(
  predicate: () => Promise<boolean>,
  options: WaitUntilOptions,
): Promise<void> {
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? Bun.sleep
  const intervalMs = options.intervalMs ?? 200
  const deadline = now() + options.timeoutMs
  while (true) {
    if (await predicate()) return
    const remaining = deadline - now()
    if (remaining <= 0) throw new Error(options.message)
    await sleep(Math.min(intervalMs, remaining))
  }
}

export function hasManagedDaemonStopped(
  launchd: LaunchctlState,
  health: DaemonHealth,
  expectedPid: number | null,
): boolean {
  if (launchd.loaded) return false
  if (!health.reachable) return true
  return expectedPid !== null && health.pid !== expectedPid
}

function xml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function unreachableHealth(): DaemonHealth {
  return {
    reachable: false,
    pid: null,
    version: null,
    protocolVersion: null,
    codexConnected: false,
    claudeConnected: false,
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
