import type { Project } from '../../src/domain/types'

/**
 * The deepest discovered checkout containing `cwd` wins, so worktrees under a
 * project resolve without registering each one; the GitHub repository identity
 * is the fallback for worktrees living outside the checkout.
 */
export function resolveProject(
  projects: readonly Project[],
  cwd: string,
  repository: string | null,
): Project | null {
  return (
    projects
      .filter((project) => cwd === project.directory || cwd.startsWith(`${project.directory}/`))
      .sort((left, right) => right.directory.length - left.directory.length)[0] ??
    projects.find((project) => repository && project.repository === repository) ??
    null
  )
}

export function compactTitle(value: string): string {
  const singleLine = value.trim().replace(/\s+/g, ' ')
  return singleLine.length > 84 ? `${singleLine.slice(0, 81).trimEnd()}…` : singleLine
}
