import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e/hosted',
  use: { baseURL: 'http://127.0.0.1:4181', trace: 'retain-on-failure' },
  // The phone project runs the tests tagged @phone, and only those; the desktop one runs the rest.
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, grepInvert: /@phone/ },
    { name: 'phone', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, hasTouch: true }, grep: /@phone/ },
  ],
  webServer: { command: 'pnpm build && tsx e2e/hosted/start.ts', url: 'http://127.0.0.1:4181/', reuseExistingServer: false, timeout: 180_000 },
})
