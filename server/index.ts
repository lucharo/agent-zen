import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { AgentZenBridgeService } from './bridgeService'
import { CodexAppServerClient } from './codex/appServerClient'
import { ClaudeBackend } from './claude/claudeBackend'
import { CodexBackend } from './codex/codexBackend'
import { CodexStateObserver } from './codex/stateObserver'
import { createBridgeRequestHandler, createFrontendProxyRequestHandler } from './http'
import { AgentZenSettingsStore } from './settings'
import packageJson from '../package.json'

const port = Number(process.env.AGENT_ZEN_PORT ?? 5274)
const repositoryRoot = resolve(import.meta.dir, '..')
const packaged = Boolean(process.env.AGENT_ZEN_DIST_DIR)
const allowedOrigins = process.env.AGENT_ZEN_APP_ORIGIN
  ? [process.env.AGENT_ZEN_APP_ORIGIN]
  : packaged
    ? []
    : ['http://127.0.0.1:5273', 'http://localhost:5273']
const frontendBuildId = process.env.AGENT_ZEN_FRONTEND_BUILD_ID
const upstreamBridgeUrl = loopbackUpstreamUrl(process.env.AGENT_ZEN_UPSTREAM_BRIDGE_URL, port)
const parentPid = positiveInteger(process.env.AGENT_ZEN_PARENT_PID)
let closeRuntime = async (): Promise<void> => {}
let requestHandler: (request: Request) => Promise<Response>

if (upstreamBridgeUrl && frontendBuildId) {
  requestHandler = createFrontendProxyRequestHandler({
    port,
    distDirectory: process.env.AGENT_ZEN_DIST_DIR ?? join(repositoryRoot, 'dist'),
    upstreamBaseUrl: upstreamBridgeUrl,
    frontendBuildId,
  })
} else {
  const settings = new AgentZenSettingsStore({
    settingsPath: join(homedir(), '.agent-zen', 'settings.json'),
    defaultProjectRoots: [join(homedir(), 'Projects', 'github.com')],
    initialProjectDirectory: packaged
      ? process.env.AGENT_ZEN_INITIAL_PROJECT_DIRECTORY ?? null
      : repositoryRoot,
  })
  const client = new CodexAppServerClient({
    command: [process.env.AGENT_ZEN_CODEX_PATH ?? 'codex', 'app-server', '--stdio'],
  })
  const getProjects = async () =>
    (await settings.discoverProjects()).map(({ id, name, directory, repository }) => ({
      id,
      name,
      directory,
      repository,
    }))
  const observer = new CodexStateObserver({
    dbPath: join(homedir(), '.codex', 'state_5.sqlite'),
    getProjects,
  })
  const service = new AgentZenBridgeService({
    settings,
    backends: [
      new CodexBackend({ client, observer }),
      new ClaudeBackend({
        claudeHome: process.env.AGENT_ZEN_CLAUDE_HOME ?? join(homedir(), '.claude'),
        getProjects,
      }),
    ],
  })
  await service.start()
  requestHandler = createBridgeRequestHandler({
    service,
    port,
    distDirectory: process.env.AGENT_ZEN_DIST_DIR ?? join(repositoryRoot, 'dist'),
    allowedOrigins,
    runtime: { pid: process.pid, version: packageJson.version },
    frontendBuildId,
    frontendApiPort: port,
  })
  closeRuntime = () => service.close()
}

const server = Bun.serve({
  hostname: '127.0.0.1',
  port,
  idleTimeout: 30,
  fetch: requestHandler,
})

console.log(`Agent Zen bridge listening on ${server.url}`)

let shutdownPromise: Promise<void> | null = null
let parentMonitor: ReturnType<typeof setInterval> | null = null
const shutdown = (): Promise<void> => {
  shutdownPromise ??= (async () => {
    if (parentMonitor) {
      clearInterval(parentMonitor)
      parentMonitor = null
    }
    await server.stop(false)
    await closeRuntime()
  })()
  return shutdownPromise
}
const requestShutdown = () => {
  void shutdown().catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
}
process.once('SIGINT', requestShutdown)
process.once('SIGTERM', requestShutdown)
if (parentPid) {
  parentMonitor = setInterval(() => {
    try {
      process.kill(parentPid, 0)
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') requestShutdown()
    }
  }, 1_000)
}

function positiveInteger(value: string | undefined): number | null {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

function loopbackUpstreamUrl(value: string | undefined, servingPort: number): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    if (
      url.protocol !== 'http:'
      || url.hostname !== '127.0.0.1'
      || !url.port
      || Number(url.port) === servingPort
    ) return null
    return url.origin
  } catch {
    return null
  }
}
