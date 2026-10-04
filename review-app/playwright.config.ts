import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  use: { baseURL: 'http://127.0.0.1:4180', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: { command: 'pnpm build && tsx e2e/start.ts', url: 'http://127.0.0.1:4180/api/queues', reuseExistingServer: false, timeout: 120_000 },
})
