import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { ProjectCandidate } from '../src/adapters/ProjectDiscoverySource'
import {
  normaliseUiPreferences,
  type UiPreferences,
} from '../src/domain/preferences'
import type { Project } from '../src/domain/types'
import type { FocusSettings } from './domain/focusPolicy'
import { discoverProjects } from './projects'

/** How long a finished discovery round is reused; the board polls every second. */
const DISCOVERY_TTL_MS = 30_000

export interface SettingsFile {
  readonly version: 2
  readonly focus: FocusSettings
  readonly preferences: UiPreferences | null
  readonly projectRoots: readonly string[]
  readonly registeredProjectDirectories: readonly string[]
}

interface LegacySettingsFile {
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
  private writeQueue: Promise<void> = Promise.resolve()
  /** The current discovery round; `settledAt` stays null while it runs, so no second round starts beside it. */
  private discovery: { readonly value: Promise<ProjectCandidate[]>; settledAt: number | null } | null = null

  constructor(private readonly options: AgentZenSettingsStoreOptions) {}

  async read(): Promise<SettingsFile> {
    return this.readFromDisk()
  }

  private async readFromDisk(): Promise<SettingsFile> {
    const fallback = this.defaults()
    try {
      const parsed = JSON.parse(await readFile(this.options.settingsPath, 'utf8')) as
        | Partial<SettingsFile>
        | Partial<LegacySettingsFile>
      if (parsed.version !== 1 && parsed.version !== 2) return fallback
      return {
        version: 2,
        focus: normaliseFocus(parsed.focus),
        preferences: parsed.version === 2
          ? normaliseUiPreferences(parsed.preferences)
          : null,
        projectRoots: strings(parsed.projectRoots, fallback.projectRoots),
        registeredProjectDirectories: strings(
          parsed.registeredProjectDirectories,
          fallback.registeredProjectDirectories,
        ),
      }
    } catch {
      return fallback
    }
  }

  async setFocus(focus: FocusSettings): Promise<SettingsFile> {
    return this.mutate((current) => ({ ...current, focus: normaliseFocus(focus) }))
  }

  async setPreferences(preferences: UiPreferences): Promise<SettingsFile> {
    const normalised = normaliseUiPreferences(preferences)
    if (!normalised) throw new Error('UI preferences are required.')
    return this.mutate((current) => ({ ...current, preferences: normalised }))
  }

  /**
   * One discovery round at a time: every caller during a round shares it, and the
   * result is reused for DISCOVERY_TTL_MS counted from when the round finished, so a
   * slow round on a busy machine never has a second one started on top of it.
   */
  discoverProjects(): Promise<ProjectCandidate[]> {
    const current = this.discovery
    if (current && (current.settledAt === null || Date.now() - current.settledAt < DISCOVERY_TTL_MS)) {
      return current.value
    }
    // Claim the slot before the first await, so callers in the same tick join this round.
    const value = this.read().then((settings) => discoverProjects(settings.projectRoots))
    const round: { readonly value: Promise<ProjectCandidate[]>; settledAt: number | null } = {
      value,
      settledAt: null,
    }
    this.discovery = round
    value.then(
      () => {
        round.settledAt = Date.now()
      },
      () => {
        if (this.discovery === round) this.discovery = null
      },
    )
    return value
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
      version: 2,
      focus: { enabled: false, limit: 3 },
      preferences: null,
      projectRoots: [...this.options.defaultProjectRoots],
      registeredProjectDirectories: this.options.initialProjectDirectory
        ? [this.options.initialProjectDirectory]
        : [],
    }
  }

  private async mutate(update: (current: SettingsFile) => SettingsFile): Promise<SettingsFile> {
    const operation = this.writeQueue
      .catch(() => undefined)
      .then(() => this.withSettingsLock(async () => {
        const result = update(await this.readFromDisk())
        await this.persist(result)
        return result
      }))
    this.writeQueue = operation.then(() => undefined, () => undefined)
    return operation
  }

  private async withSettingsLock<T>(operation: () => Promise<T>): Promise<T> {
    await mkdir(dirname(this.options.settingsPath), { recursive: true })
    const lockPath = `${this.options.settingsPath}.lock`
    const deadline = Date.now() + 10_000
    while (true) {
      try {
        await mkdir(lockPath)
        break
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        try {
          const lock = await stat(lockPath)
          if (Date.now() - lock.mtimeMs > 30_000) {
            await rm(lockPath, { recursive: true, force: true })
            continue
          }
        } catch {
          continue
        }
        if (Date.now() >= deadline) throw new Error('Timed out waiting for the Agent Zen settings lock.')
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
    }
    try {
      return await operation()
    } finally {
      await rm(lockPath, { recursive: true, force: true })
    }
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
