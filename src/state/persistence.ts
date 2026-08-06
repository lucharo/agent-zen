import type {
  Idea,
  IdeaGroupBy,
  IdeaLayout,
  LogbookNote,
  Project,
  SemanticEvent,
  StageOverride,
  ThemeChoice,
  View,
} from '@/domain/types'
import { SEED_PROJECTS, seedIdeas, seedLogbook } from './seed'

export const STORAGE_KEY = 'agent-zen.state.v1'
/** Written separately so `index.html` can read it before React boots. */
export const THEME_KEY = 'agent-zen.theme'

/**
 * Everything Agent Zen owns. Nothing agent-derived is stored here — a wiped
 * store loses ideas and Logbook notes, never session state.
 */
export interface PersistedState {
  readonly version: 1
  readonly projects: readonly Project[]
  readonly ideas: readonly Idea[]
  readonly overrides: readonly StageOverride[]
  readonly events: readonly SemanticEvent[]
  readonly logbook: readonly LogbookNote[]
  readonly theme: ThemeChoice
  readonly view: View
  readonly projectFilter: string | null
  readonly ideaGroupBy: IdeaGroupBy
  readonly ideaLayout: IdeaLayout
  readonly ideasFolded: boolean
  readonly activeLimit: number
}

export function createInitialState(now: number): PersistedState {
  return {
    version: 1,
    projects: SEED_PROJECTS,
    ideas: seedIdeas(now),
    overrides: [],
    events: [],
    logbook: seedLogbook(now),
    theme: 'system',
    view: 'kanban',
    projectFilter: null,
    ideaGroupBy: 'created',
    ideaLayout: 'grid',
    ideasFolded: false,
    activeLimit: 3,
  }
}

/**
 * Merge over defaults rather than trusting the stored blob, so a store written
 * by an older build still loads instead of blanking the app.
 */
export function loadState(storage: Storage | undefined, now: number): PersistedState {
  const fallback = createInitialState(now)
  if (!storage) return fallback
  let raw: string | null = null
  try {
    raw = storage.getItem(STORAGE_KEY)
  } catch {
    return fallback
  }
  if (!raw) return fallback
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedState>
    if (parsed?.version !== 1) return fallback
    return { ...fallback, ...parsed, version: 1 }
  } catch {
    return fallback
  }
}

export function saveState(storage: Storage | undefined, state: PersistedState): void {
  if (!storage) return
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state))
    storage.setItem(THEME_KEY, state.theme)
  } catch {
    // A full or blocked store must not take the app down.
  }
}

export function resolveTheme(choice: ThemeChoice, prefersDark: boolean): 'light' | 'dark' {
  if (choice === 'system') return prefersDark ? 'dark' : 'light'
  return choice
}

let counter = 0

export function newId(prefix: string): string {
  counter += 1
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.abs(Math.floor(performance.now() * 1000)).toString(36)
  return `${prefix}-${random}-${counter}`
}
