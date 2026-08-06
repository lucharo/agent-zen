import type { ProjectDiscoverySource } from './ProjectDiscoverySource'

export function createFixtureProjectDiscoverySource(): ProjectDiscoverySource {
  return {
    mode: 'fixture',
    label: 'Sample local repositories',
    snapshot: () => [
      {
        id: 'proj-taskflow',
        name: 'taskflow',
        directory: '~/Projects/github.com/lucharo/taskflow',
        repository: 'lucharo/taskflow',
        defaultBranch: 'main',
      },
      {
        id: 'proj-genimg',
        name: 'genimg',
        directory: '~/Projects/github.com/lucharo/genimg',
        repository: 'lucharo/genimg',
        defaultBranch: 'main',
      },
      {
        id: 'proj-skills',
        name: 'skills',
        directory: '~/.refined',
        repository: 'lucharo/skills',
        defaultBranch: 'main',
      },
    ],
  }
}
