import { expect, test } from '@playwright/test'
import type { BridgeSnapshot } from '../../src/bridge/types'
import type { AgentSession } from '../../src/domain/types'

const project = {
  id: 'project-demo',
  name: 'demo',
  directory: '/Users/demo/Projects/demo',
  repository: 'lucharo/demo',
}

const session = (index: number): AgentSession => ({
  id: `session-${index}`,
  threadId: `thread-${index}`,
  turnId: `turn-${index}`,
  title: `Running session ${index}`,
  agent: 'codex',
  source: 'external',
  model: 'gpt-test',
  reasoningEffort: 'high',
  cliVersion: '0.146.0',
  createdAt: '2026-08-07T08:00:00.000Z',
  turnStartedAt: '2026-08-07T09:00:00.000Z',
  activity: 'working',
  parentSessionId: null,
  cwd: project.directory,
  repository: project.repository,
  branch: 'main',
  worktree: project.directory,
  projectId: project.id,
  plan: {
    revision: 1,
    updatedAt: '2026-08-07T09:00:00.000Z',
    explanation: null,
    steps: [
      { step: 'Inspect', status: 'completed' },
      { step: `Build slice ${index}`, status: 'in_progress' },
      { step: 'Verify', status: 'pending' },
    ],
  },
  planHistory: [],
  review: null,
  wrapup: null,
  endedAt: null,
})

const snapshot: BridgeSnapshot = {
  protocolVersion: 2,
  generatedAt: '2026-08-07T10:00:00.000Z',
  connection: { connected: true, label: 'Live Codex', userAgent: 'test', error: null },
  sessions: Array.from({ length: 8 }, (_, index) => session(index + 1)),
  focus: {
    enabled: false,
    limit: 3,
    activeCount: 8,
    availability: { allowed: true, reason: 'limit-disabled' },
  },
  projects: [project],
  projectCandidates: [{ ...project, defaultBranch: 'main' }],
}

test('the board owns horizontal scrolling while columns own vertical scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 })
  await page.route('**/api/snapshot', (route) => route.fulfill({ json: snapshot }))
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Running session 1' })).toBeVisible()

  const pageOverflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))
  expect(pageOverflow.scrollWidth).toBe(pageOverflow.clientWidth)

  const running = page.getByRole('region', { name: 'Running' })
  const board = running.locator('xpath=..')
  const box = await running.boundingBox()
  expect(box).not.toBeNull()

  await page.mouse.move((box?.x ?? 0) + 80, (box?.y ?? 0) + 180)
  await page.mouse.wheel(0, 360)
  await expect.poll(() => running.evaluate((region) => {
    const scroller = [...region.querySelectorAll('div')].find((element) =>
      element.scrollHeight > element.clientHeight && getComputedStyle(element).overflowY === 'auto',
    )
    return scroller?.scrollTop ?? 0
  })).toBeGreaterThan(0)

  await page.mouse.wheel(320, 0)
  await expect.poll(() => board.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0)
})
