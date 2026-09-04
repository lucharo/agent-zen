import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { BRIDGE_MUTATION_PATH, type BridgeSnapshot } from '../../src/bridge/types'
import { DEFAULT_UI_PREFERENCES } from '../../src/domain/preferences'

async function expectAccessible(page: Page, surface: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  expect(results.violations, `${surface}: ${JSON.stringify(results.violations, null, 2)}`).toEqual([])
}

test('primary surfaces meet the WCAG 2.2 AA axe rules', async ({ page }) => {
  let preferences = DEFAULT_UI_PREFERENCES
  let latestSnapshot: BridgeSnapshot | null = null
  await page.route(`**${BRIDGE_MUTATION_PATH}/settings/preferences`, async (route) => {
    preferences = route.request().postDataJSON()
    if (!latestSnapshot) throw new Error('Preference mutation arrived before the first snapshot.')
    latestSnapshot = {
      ...latestSnapshot,
      generatedAt: new Date().toISOString(),
      preferences,
    }
    await route.fulfill({ json: latestSnapshot })
  })
  await page.route('**/api/snapshot', async (route) => {
    const response = await route.fetch()
    const snapshot = await response.json()
    latestSnapshot = { ...snapshot, preferences }
    await route.fulfill({ response, json: latestSnapshot })
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Running', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /Quick capture/ })).toBeVisible()
  await expectAccessible(page, 'Sessions Kanban')

  if (process.env.AGENT_ZEN_REQUIRE_LIVE === '1') {
    await page.keyboard.press('Meta+,')
    const liveSettings = page.getByRole('dialog', { name: 'Settings' })
    await expect(liveSettings.getByText('Live', { exact: true })).toBeVisible()
    await expect(liveSettings.getByText('Codex', { exact: true })).toBeVisible()
    await expect(liveSettings.getByText('Claude Code', { exact: true })).toBeVisible()
    await expect(liveSettings.getByRole('alert')).toHaveCount(0)
    await page.keyboard.press('Escape')
  }

  await page.keyboard.press('c')
  const capture = page.getByRole('dialog', { name: 'Quick capture' })
  await expect(capture).toBeVisible()
  await expect(capture).toHaveCSS('opacity', '1')
  await expect(capture.getByLabel('Title')).toBeFocused()
  const box = await capture.boundingBox()
  expect(box).not.toBeNull()
  expect(Math.abs((box?.x ?? 0) + (box?.width ?? 0) / 2 - 720)).toBeLessThan(2)
  await expectAccessible(page, 'Quick capture')
  await capture.getByLabel('Title').fill('Accessibility confirmation')
  await capture.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('status')).toHaveText('Saved to Ideas')
  await expectAccessible(page, 'Capture confirmation')

  await page.getByRole('tab', { name: 'Ideas' }).click()
  await expect(page.getByRole('tab', { name: 'Ideas' })).toHaveAttribute('aria-selected', 'true')
  await expectAccessible(page, 'Ideas')

  await page.keyboard.press('Meta+k')
  const palette = page.getByRole('dialog', { name: 'Command palette' })
  await expect(palette).toBeVisible()
  await expect(palette).toHaveCSS('opacity', '1')
  await expect(palette.getByRole('combobox')).toHaveAttribute('aria-controls', 'command-palette-results')
  await expectAccessible(page, 'Command palette')
  await page.keyboard.press('Escape')

  await page.keyboard.press('Meta+,')
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await expect(settings).toBeVisible()
  await expect(settings).toHaveCSS('opacity', '1')
  await page.keyboard.press('c')
  await expect(page.getByRole('dialog')).toHaveCount(1)
  await expectAccessible(page, 'Settings')

  await page.keyboard.press('Escape')
  await page.getByRole('tab', { name: 'Sessions' }).click()
  const theme = page.getByRole('button', { name: /Theme:/ })
  await theme.click()
  await theme.click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.getByRole('tab', { name: 'Sessions' })).toHaveCSS('color', 'rgb(242, 242, 244)')
  await expectAccessible(page, 'Sessions dark theme')

  await page.keyboard.press('Meta+,')
  const darkSettings = page.getByRole('dialog', { name: 'Settings' })
  await expect(darkSettings).toHaveCSS('opacity', '1')
  await expectAccessible(page, 'Settings dark theme')

  await page.unrouteAll({ behavior: 'ignoreErrors' })
})
