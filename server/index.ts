import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { AgentZenBridgeService } from './bridgeService'
import { CodexAppServerClient } from './codex/appServerClient'
import { CodexStateObserver } from './codex/stateObserver'
import { createBridgeRequestHandler } from './http'
import { AgentZenSettingsStore } from './settings'

const port = Number(process.env.AGENT_ZEN_PORT ?? 5274)
const repositoryRoot = resolve(import.meta.dir, '..')
const settings = new AgentZenSettingsStore({
  settingsPath: join(homedir(), '.agent-zen', 'settings.json'),
  defaultProjectRoots: [join(homedir(), 'Projects', 'github.com')],
  initialProjectDirectory: repositoryRoot,
})
const client = new CodexAppServerClient()
const observer = new CodexStateObserver({
  dbPath: join(homedir(), '.codex', 'state_5.sqlite'),
  getProjects: () => settings.registeredProjects(),
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
    distDirectory: join(repositoryRoot, 'dist'),
  }),
})

console.log(`Agent Zen bridge listening on ${server.url}`)

const shutdown = async () => {
  server.stop(false)
  await service.close()
}
process.once('SIGINT', () => void shutdown())
process.once('SIGTERM', () => void shutdown())
