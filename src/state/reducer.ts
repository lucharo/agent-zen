import type {
  CaptureAction,
  IdeaGroupBy,
  IdeaLayout,
  SemanticEventKind,
  Stage,
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
  | { type: 'toggle-ideas-fold' }
  | { type: 'set-active-limit'; limit: number }
  | { type: 'capture-idea'; draft: CaptureDraft; now: number }
  | { type: 'delete-idea'; ideaId: string }
  | { type: 'record-event'; sessionId: string; kind: SemanticEventKind; now: number }
  | { type: 'set-stage-override'; sessionId: string; stage: Stage; now: number }
  | { type: 'clear-stage-override'; sessionId: string }
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

    case 'toggle-ideas-fold':
      return { ...state, ideasFolded: !state.ideasFolded }

    case 'set-active-limit':
      return { ...state, activeLimit: Math.min(9, Math.max(1, action.limit)) }

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

    case 'record-event':
      return {
        ...state,
        events: [
          ...state.events,
          {
            id: newId('event'),
            sessionId: action.sessionId,
            kind: action.kind,
            at: new Date(action.now).toISOString(),
          },
        ],
      }

    case 'set-stage-override':
      return {
        ...state,
        overrides: [
          ...state.overrides.filter((o) => o.sessionId !== action.sessionId),
          {
            sessionId: action.sessionId,
            stage: action.stage,
            at: new Date(action.now).toISOString(),
          },
        ],
      }

    case 'clear-stage-override':
      return {
        ...state,
        overrides: state.overrides.filter((o) => o.sessionId !== action.sessionId),
      }

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
