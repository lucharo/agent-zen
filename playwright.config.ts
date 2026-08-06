import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './qa/e2e',
  outputDir: './test-results',
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:5273',
    viewport: { width: 1440, height: 900 },
    colorScheme: 'light',
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'bun run bridge',
      url: 'http://127.0.0.1:5274/api/health',
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: 'bun run dev -- --host 127.0.0.1 --port 5273',
      url: 'http://127.0.0.1:5273',
      reuseExistingServer: true,
      timeout: 30_000,
    },
  ],
})
