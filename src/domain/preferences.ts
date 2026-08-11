import type {
  IdeaGroupBy,
  IdeaLayout,
  KanbanCardDetail,
  KanbanGroupBy,
  SessionLayout,
  ThemeChoice,
  View,
} from './types'

export interface UiPreferences {
  readonly theme: ThemeChoice
  readonly view: View
  readonly projectFilter: string | null
  readonly ideaGroupBy: IdeaGroupBy
  readonly ideaLayout: IdeaLayout
  readonly sessionLayout: SessionLayout
  readonly kanbanGroupBy: KanbanGroupBy
  readonly kanbanCardDetail: KanbanCardDetail
  readonly ideasFolded: boolean
}

export const DEFAULT_UI_PREFERENCES: UiPreferences = {
  theme: 'system',
  view: 'kanban',
  projectFilter: null,
  ideaGroupBy: 'created',
  ideaLayout: 'grid',
  sessionLayout: 'kanban',
  kanbanGroupBy: 'none',
  kanbanCardDetail: 'titles',
  ideasFolded: false,
}

export function selectUiPreferences(preferences: UiPreferences): UiPreferences {
  return {
    theme: preferences.theme,
    view: preferences.view,
    projectFilter: preferences.projectFilter,
    ideaGroupBy: preferences.ideaGroupBy,
    ideaLayout: preferences.ideaLayout,
    sessionLayout: preferences.sessionLayout,
    kanbanGroupBy: preferences.kanbanGroupBy,
    kanbanCardDetail: preferences.kanbanCardDetail,
    ideasFolded: preferences.ideasFolded,
  }
}

export function normaliseUiPreferences(value: unknown): UiPreferences | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const preferences = value as Partial<UiPreferences>
  return {
    theme: oneOf(preferences.theme, ['system', 'light', 'dark'], 'system'),
    view: oneOf(preferences.view, ['kanban', 'ideas'], 'kanban'),
    projectFilter: typeof preferences.projectFilter === 'string' ? preferences.projectFilter : null,
    ideaGroupBy: oneOf(preferences.ideaGroupBy, ['created', 'project'], 'created'),
    ideaLayout: oneOf(preferences.ideaLayout, ['grid', 'list'], 'grid'),
    sessionLayout: oneOf(preferences.sessionLayout, ['kanban', 'grid'], 'kanban'),
    kanbanGroupBy: oneOf(preferences.kanbanGroupBy, ['none', 'project'], 'none'),
    kanbanCardDetail: oneOf(preferences.kanbanCardDetail, ['titles', 'details', 'comments'], 'titles'),
    ideasFolded: preferences.ideasFolded === true,
  }
}

function oneOf<const T extends string>(
  value: unknown,
  choices: readonly T[],
  fallback: T,
): T {
  return typeof value === 'string' && choices.includes(value as T) ? (value as T) : fallback
}
