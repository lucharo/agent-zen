import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { AgentZenBridgeService } from './bridgeService'
import { CodexAppServerClient } from './codex/appServerClient'
import { CodexStateObserver } from './codex/stateObserver'
import { createBridgeRequestHandler } from './http'
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
const observer = new CodexStateObserver({
  dbPath: join(homedir(), '.codex', 'state_5.sqlite'),
  getProjects: async () =>
    (await settings.discoverProjects()).map(({ id, name, directory, repository }) => ({
      id,
      name,
      directory,
      repository,
    })),
})
const service = new AgentZenBridgeService({ settings, observer, client })
await service.start()

const server = Bun.serve({
  hostname: '127.0.0.1',
  port,
  idleTimeout: 30,
  fetch: createBridgeRequestHandler({
    service,
    port,
    distDirectory: process.env.AGENT_ZEN_DIST_DIR ?? join(repositoryRoot, 'dist'),
    allowedOrigins,
    runtime: { pid: process.pid, version: packageJson.version },
  }),
})

console.log(`Agent Zen bridge listening on ${server.url}`)

let shutdownPromise: Promise<void> | null = null
const shutdown = (): Promise<void> => {
  shutdownPromise ??= (async () => {
    await server.stop(false)
    await service.close()
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
