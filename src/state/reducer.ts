import type {
  CaptureAction,
  IdeaGroupBy,
  IdeaLayout,
  KanbanCardDetail,
  KanbanGroupBy,
  Project,
  SessionLayout,
  ThemeChoice,
  View,
} from '@/domain/types'
import { newId, type PersistedState } from './persistence'

export interface CaptureDraft {
  readonly title: string
  readonly notes: string
  readonly projectId: string | null
  readonly repository: string | null
  readonly action: CaptureAction
}

export type Action =
  | { type: 'set-view'; view: View }
  | { type: 'set-theme'; theme: ThemeChoice }
  | { type: 'set-project-filter'; projectId: string | null }
  | { type: 'set-idea-group-by'; groupBy: IdeaGroupBy }
  | { type: 'set-idea-layout'; layout: IdeaLayout }
  | { type: 'set-session-layout'; layout: SessionLayout }
  | { type: 'set-kanban-group-by'; groupBy: KanbanGroupBy }
  | { type: 'set-kanban-card-detail'; detail: KanbanCardDetail }
  | { type: 'toggle-ideas-fold' }
  | { type: 'set-active-limit-enabled'; enabled: boolean }
  | { type: 'set-active-limit'; limit: number }
  | {
      type: 'sync-bridge-settings'
      projects: readonly Project[]
      knownProjectIds: readonly string[]
      activeLimitEnabled: boolean
      activeLimit: number
    }
  | { type: 'add-projects'; projects: readonly Project[] }
  | { type: 'capture-idea'; draft: CaptureDraft; now: number }
  | { type: 'delete-idea'; ideaId: string }
  | { type: 'add-logbook-note'; subjectId: string; body: string; now: number }

export function reducer(state: PersistedState, action: Action): PersistedState {
  switch (action.type) {
    case 'set-view':
      return { ...state, view: action.view }

    case 'set-theme':
      return { ...state, theme: action.theme }

    case 'set-project-filter':
      return { ...state, projectFilter: action.projectId }

    case 'set-idea-group-by':
      return { ...state, ideaGroupBy: action.groupBy }

    case 'set-idea-layout':
      return { ...state, ideaLayout: action.layout }

    case 'set-session-layout':
      return { ...state, sessionLayout: action.layout }

    case 'set-kanban-group-by':
      return { ...state, kanbanGroupBy: action.groupBy }

    case 'set-kanban-card-detail':
      return { ...state, kanbanCardDetail: action.detail }

    case 'toggle-ideas-fold':
      return { ...state, ideasFolded: !state.ideasFolded }

    case 'set-active-limit-enabled':
      return { ...state, activeLimitEnabled: action.enabled }

    case 'set-active-limit':
      return { ...state, activeLimit: Math.min(9, Math.max(1, action.limit)) }

    case 'sync-bridge-settings': {
      const remap = new Map<string, string>()
      for (const previous of state.projects) {
        const replacement = action.projects.find(
          (project) =>
            (previous.repository && project.repository === previous.repository) ||
            project.directory === previous.directory ||
            project.name === previous.name,
        )
        if (replacement) remap.set(previous.id, replacement.id)
      }
      const projects = [...action.projects]
      const projectIds = new Set(action.knownProjectIds)
      const ideas = state.ideas.map((idea) => ({
        ...idea,
        projectId: idea.projectId
          ? projectIds.has(idea.projectId)
            ? idea.projectId
            : remap.get(idea.projectId) ?? null
          : null,
      }))
      const projectFilter = state.projectFilter
        ? projectIds.has(state.projectFilter)
          ? state.projectFilter
          : remap.get(state.projectFilter) ?? null
        : null
      return {
        ...state,
        projects,
        ideas,
        projectFilter,
        activeLimitEnabled: action.activeLimitEnabled,
        activeLimit: Math.min(9, Math.max(1, action.activeLimit)),
      }
    }

    case 'add-projects': {
      const known = new Set(
        state.projects.flatMap((project) => [project.directory, project.repository].filter(Boolean)),
      )
      const additions: Project[] = []
      for (const project of action.projects) {
        if (known.has(project.directory) || (project.repository && known.has(project.repository))) {
          continue
        }
        additions.push(project)
        known.add(project.directory)
        if (project.repository) known.add(project.repository)
      }
      return additions.length ? { ...state, projects: [...state.projects, ...additions] } : state
    }

    case 'capture-idea': {
      const title = action.draft.title.trim()
      if (!title) return state
      return {
        ...state,
        ideas: [
          {
            id: newId('idea'),
            title,
            notes: action.draft.notes.trim(),
            projectId: action.draft.projectId,
            repository: action.draft.repository,
            action: action.draft.action,
            createdAt: new Date(action.now).toISOString(),
          },
          ...state.ideas,
        ],
      }
    }

    case 'delete-idea':
      return { ...state, ideas: state.ideas.filter((i) => i.id !== action.ideaId) }

    case 'add-logbook-note': {
      const body = action.body.trim()
      if (!body) return state
      // Append-only by construction: notes are added, never replaced, and the
      // author is fixed. No reducer path lets an agent write here.
      return {
        ...state,
        logbook: [
          ...state.logbook,
          {
            id: newId('note'),
            subjectId: action.subjectId,
            body,
            createdAt: new Date(action.now).toISOString(),
            author: 'human',
          },
        ],
      }
    }
  }
}
