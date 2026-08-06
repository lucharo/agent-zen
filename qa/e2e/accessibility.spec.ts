import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

async function expectAccessible(page: Page, surface: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  expect(results.violations, `${surface}: ${JSON.stringify(results.violations, null, 2)}`).toEqual([])
}

test('primary surfaces meet the WCAG 2.2 AA axe rules', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Running' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Quick capture/ })).toBeVisible()
  await expectAccessible(page, 'Kanban')

  if (process.env.AGENT_ZEN_REQUIRE_LIVE === '1') {
    await page.keyboard.press('Meta+,')
    const liveSettings = page.getByRole('dialog', { name: 'Settings' })
    await expect(liveSettings.getByText(/Live Codex/)).toBeVisible()
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
  await page.getByRole('tab', { name: 'Kanban' }).click()
  const theme = page.getByRole('button', { name: /Theme:/ })
  await theme.click()
  await theme.click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.getByRole('tab', { name: 'Kanban' })).toHaveCSS('color', 'rgb(242, 242, 244)')
  await expectAccessible(page, 'Kanban dark theme')

  await page.keyboard.press('Meta+,')
  const darkSettings = page.getByRole('dialog', { name: 'Settings' })
  await expect(darkSettings).toHaveCSS('opacity', '1')
  await expectAccessible(page, 'Settings dark theme')
})
