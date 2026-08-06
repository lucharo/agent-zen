import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { ProjectCandidate } from '../src/adapters/ProjectDiscoverySource'
import type { Project } from '../src/domain/types'
import type { FocusSettings } from './domain/focusPolicy'
import { discoverProjects } from './projects'

interface SettingsFile {
  readonly version: 1
  readonly focus: FocusSettings
  readonly projectRoots: readonly string[]
  readonly registeredProjectDirectories: readonly string[]
}

export interface AgentZenSettingsStoreOptions {
  readonly settingsPath: string
  readonly defaultProjectRoots: readonly string[]
  readonly initialProjectDirectory?: string | null
}

export class AgentZenSettingsStore {
  private state: SettingsFile | null = null
  private writeQueue: Promise<void> = Promise.resolve()
  private discoveryCache: { readonly expiresAt: number; readonly value: Promise<ProjectCandidate[]> } | null = null

  constructor(private readonly options: AgentZenSettingsStoreOptions) {}

  async read(): Promise<SettingsFile> {
    if (this.state) return this.state
    const fallback = this.defaults()
    try {
      const parsed = JSON.parse(await readFile(this.options.settingsPath, 'utf8')) as Partial<SettingsFile>
      if (parsed.version !== 1) return (this.state = fallback)
      this.state = {
        version: 1,
        focus: normaliseFocus(parsed.focus),
        projectRoots: strings(parsed.projectRoots, fallback.projectRoots),
        registeredProjectDirectories: strings(
          parsed.registeredProjectDirectories,
          fallback.registeredProjectDirectories,
        ),
      }
    } catch {
      this.state = fallback
    }
    return this.state
  }

  async setFocus(focus: FocusSettings): Promise<SettingsFile> {
    return this.mutate((current) => ({ ...current, focus: normaliseFocus(focus) }))
  }

  async discoverProjects(): Promise<ProjectCandidate[]> {
    const now = Date.now()
    if (this.discoveryCache && this.discoveryCache.expiresAt > now) {
      return this.discoveryCache.value
    }
    const settings = await this.read()
    const value = discoverProjects(settings.projectRoots)
    this.discoveryCache = { expiresAt: now + 30_000, value }
    try {
      return await value
    } catch (error) {
      this.discoveryCache = null
      throw error
    }
  }

  async registeredProjects(): Promise<Project[]> {
    const settings = await this.read()
    const selected = new Set(settings.registeredProjectDirectories)
    const candidates = await this.discoverProjects()
    return candidates
      .filter((candidate) => selected.has(candidate.directory))
      .map(({ id, name, directory, repository }) => ({ id, name, directory, repository }))
  }

  async registerProjects(candidateIds: readonly string[]): Promise<Project[]> {
    const candidates = await this.discoverProjects()
    const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]))
    const unknown = candidateIds.find((id) => !byId.has(id))
    if (unknown) throw new Error(`Unknown project candidate: ${unknown}`)
    const directories = candidateIds.flatMap((id) => {
      const candidate = byId.get(id)
      return candidate ? [candidate.directory] : []
    })
    await this.mutate((current) => ({
      ...current,
      registeredProjectDirectories: [...new Set([...current.registeredProjectDirectories, ...directories])],
    }))
    return this.registeredProjects()
  }

  private defaults(): SettingsFile {
    return {
      version: 1,
      focus: { enabled: false, limit: 3 },
      projectRoots: [...this.options.defaultProjectRoots],
      registeredProjectDirectories: this.options.initialProjectDirectory
        ? [this.options.initialProjectDirectory]
        : [],
    }
  }

  private async mutate(update: (current: SettingsFile) => SettingsFile): Promise<SettingsFile> {
    let result: SettingsFile | null = null
    this.writeQueue = this.writeQueue.then(async () => {
      result = update(await this.read())
      this.state = result
      await this.persist(result)
    })
    await this.writeQueue
    if (!result) throw new Error('Settings update did not run.')
    return result
  }

  private async persist(settings: SettingsFile): Promise<void> {
    await mkdir(dirname(this.options.settingsPath), { recursive: true })
    const temporary = `${this.options.settingsPath}.${randomUUID()}.tmp`
    await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 })
    await rename(temporary, this.options.settingsPath)
  }
}

function normaliseFocus(value: unknown): FocusSettings {
  if (!value || typeof value !== 'object') return { enabled: false, limit: 3 }
  const focus = value as Partial<FocusSettings>
  return {
    enabled: focus.enabled === true,
    limit: Math.min(9, Math.max(1, Number.isFinite(focus.limit) ? Number(focus.limit) : 3)),
  }
}

function strings(value: unknown, fallback: readonly string[]): readonly string[] {
  if (!Array.isArray(value)) return [...fallback]
  return value.filter((entry): entry is string => typeof entry === 'string')
}
