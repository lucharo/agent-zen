import type { Project } from '@/domain/types'

export interface ProjectCandidate extends Project {
  readonly defaultBranch: string | null
}

/**
 * Project discovery is separate from the Codex session source. The live local
 * bridge will scan configured roots and read git remotes; GitHub discovery is
 * enrichment, not the authority for whether a local project exists.
 */
export interface ProjectDiscoverySource {
  readonly mode: 'fixture' | 'live'
  readonly label: string
  snapshot(): readonly ProjectCandidate[]
}
