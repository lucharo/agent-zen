import { defineConfig } from '@playwright/test'

const bridgePort = Number(process.env.AGENT_ZEN_BRIDGE_PORT ?? 5274)
const appPort = Number(process.env.AGENT_ZEN_APP_PORT ?? 5273)
const bridgeUrl = `http://127.0.0.1:${bridgePort}`
const appUrl = `http://127.0.0.1:${appPort}`

export default defineConfig({
  testDir: './qa/e2e',
  outputDir: './test-results',
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL: appUrl,
    viewport: { width: 1440, height: 900 },
    colorScheme: 'light',
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: `AGENT_ZEN_PORT=${bridgePort} AGENT_ZEN_APP_ORIGIN=${appUrl} bun run bridge`,
      url: `${bridgeUrl}/api/health`,
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: `VITE_AGENT_ZEN_BRIDGE_URL=${bridgeUrl} bun run dev -- --host 127.0.0.1 --port ${appPort}`,
      url: appUrl,
      reuseExistingServer: true,
      timeout: 30_000,
    },
  ],
})
