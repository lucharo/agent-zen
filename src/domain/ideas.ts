import type { Idea, IdeaGroupBy, Project } from './types'
import { DATE_BUCKET_LABELS, DATE_BUCKET_ORDER, dateBucket } from './time'

export interface IdeaGroup {
  readonly key: string
  readonly label: string
  readonly ideas: readonly Idea[]
}

export interface GroupIdeasOptions {
  readonly groupBy: IdeaGroupBy
  readonly projects: readonly Project[]
  readonly now: number
}

/**
 * Bucket the backlog for display. Empty groups are dropped, so a quiet backlog
 * shows two headings rather than six.
 */
export function groupIdeas(ideas: readonly Idea[], options: GroupIdeasOptions): IdeaGroup[] {
  const sorted = [...ideas].sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  if (options.groupBy === 'project') {
    const order = [...options.projects.map((p) => p.id), null]
    const name = new Map(options.projects.map((p) => [p.id, p.name]))
    return order
      .map((projectId) => ({
        key: projectId ?? 'no-project',
        label: projectId ? (name.get(projectId) ?? projectId) : 'No project',
        ideas: sorted.filter((idea) => idea.projectId === projectId),
      }))
      .filter((group) => group.ideas.length > 0)
  }

  return DATE_BUCKET_ORDER.map((bucket) => ({
    key: bucket,
    label: DATE_BUCKET_LABELS[bucket],
    ideas: sorted.filter((idea) => dateBucket(idea.createdAt, options.now) === bucket),
  })).filter((group) => group.ideas.length > 0)
}

export function filterIdeas(
  ideas: readonly Idea[],
  filters: { projectId?: string | null; query?: string },
): Idea[] {
  const query = filters.query?.trim().toLowerCase() ?? ''
  return ideas.filter((idea) => {
    if (filters.projectId && idea.projectId !== filters.projectId) return false
    if (!query) return true
    return (
      idea.title.toLowerCase().includes(query) || idea.notes.toLowerCase().includes(query)
    )
  })
}
