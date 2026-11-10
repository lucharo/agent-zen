/** Label for sessions that belong to no registered project. */
export const NO_PROJECT_LABEL = 'No project'

/**
 * The project a single session names: its registered project, else the GitHub
 * repository it runs in, since a checkout outside the discovery roots is still
 * a project to the reader.
 */
export function sessionProjectLabel(
  project: { readonly name: string } | null | undefined,
  repository: string | null,
): string {
  return project?.name ?? repository ?? NO_PROJECT_LABEL
}
