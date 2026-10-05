import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e/hosted',
  use: { baseURL: 'http://127.0.0.1:4181', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: { command: 'pnpm build && tsx e2e/hosted/start.ts', url: 'http://127.0.0.1:4181/', reuseExistingServer: false, timeout: 180_000 },
})
