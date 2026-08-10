import { DEFAULT_UI_PREFERENCES, type UiPreferences } from '@/domain/preferences'
import type { Idea, LogbookNote, Project, ThemeChoice } from '@/domain/types'

const PROTOTYPE_PROJECT_IDS = new Set(['agent-zen', 'data-pipeline', 'acm'])
const PROTOTYPE_IDEA_IDS = new Set([
  'idea-session-dashboard',
  'idea-native-plan-reader',
  'idea-worktree-map',
  'idea-batch-visual-review',
  'idea-register-personal-repos',
  'idea-quiet-session-limits',
  'idea-pr-ready-checklist',
  'idea-auto-notes-summarizer',
  'idea-smart-context-picker',
  'idea-local-model-selector',
  'idea-review-summary-exporter',
  'idea-archive-sweep',
  'idea-worktree-gc',
  'idea-plan-drift-alerts',
  'idea-idea-to-issue-batch',
  'idea-keyboard-only-board',
  'idea-session-cost-ledger',
  'idea-repo-registration-import',
])
const PROTOTYPE_LOGBOOK_IDS = new Set([
  'note-control-plane-1',
  'note-control-plane-2',
  'note-harbor-canary-1',
  'note-worktree-map-1',
])

export const STORAGE_KEY = 'agent-zen.state.v1'
/** Written separately so `index.html` can read it before React boots. */
export const THEME_KEY = 'agent-zen.theme'

/**
 * Everything Agent Zen owns. Nothing agent-derived is stored here — a wiped
 * store loses ideas and Logbook notes, never session state.
 */
export interface PersistedState extends UiPreferences {
  readonly version: 4
  readonly projects: readonly Project[]
  readonly ideas: readonly Idea[]
  readonly logbook: readonly LogbookNote[]
  readonly activeLimitEnabled: boolean
  readonly activeLimit: number
}

export function createInitialState(_now: number): PersistedState {
  return {
    version: 4,
    projects: [],
    ideas: [],
    logbook: [],
    ...DEFAULT_UI_PREFERENCES,
    activeLimitEnabled: false,
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
    const parsed = JSON.parse(raw) as Omit<Partial<PersistedState>, 'version'> & {
      version?: number
    }
    const version = parsed?.version
    if (![1, 2, 3, 4].includes(version ?? 0)) return fallback
    const migratingPrototype = version === 1
    const migratingCompactCards = (version ?? 0) < 3
    return {
      ...fallback,
      ...parsed,
      version: 4,
      projects: migratingPrototype
        ? (parsed.projects ?? []).filter((project) => !PROTOTYPE_PROJECT_IDS.has(project.id))
        : parsed.projects ?? [],
      ideas: migratingPrototype
        ? (parsed.ideas ?? []).filter((idea) => !PROTOTYPE_IDEA_IDS.has(idea.id))
        : parsed.ideas ?? [],
      logbook: migratingPrototype
        ? (parsed.logbook ?? []).filter((note) => !PROTOTYPE_LOGBOOK_IDS.has(note.id))
        : parsed.logbook ?? [],
      kanbanCardDetail: migratingCompactCards
        ? 'titles'
        : parsed.kanbanCardDetail ?? fallback.kanbanCardDetail,
    }
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

/**
 * Live mode keeps human-authored data in the browser, but the local bridge is
 * authoritative for UI preferences. The theme key is only a pre-React paint
 * cache and is corrected from bridge settings as soon as the app connects.
 */
export function saveHumanState(storage: Storage | undefined, state: PersistedState): void {
  if (!storage) return
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({
      version: 4,
      projects: state.projects,
      ideas: state.ideas,
      logbook: state.logbook,
    }))
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
