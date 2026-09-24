import { defineConfig, devices } from '@playwright/test'

/** Accounts end to end: the preview build, proxying /api and /v1 to plan 5's Worker, which global setup starts. */
export default defineConfig({
  testDir: 'e2e',
  testMatch: 'accounts.spec.ts',
  globalSetup: './e2e/accounts.setup.ts',
  fullyParallel: false,
  workers: 1,
  use: { baseURL: 'http://localhost:4173', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm build && pnpm preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})
