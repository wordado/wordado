import { defineConfig } from '@playwright/test'
import { selectProjects } from './e2e/projects'

/** Accounts end to end: the preview build, proxying /api and /v1 to plan 5's Worker, which global setup starts. */
export default defineConfig({
  testDir: 'e2e',
  testMatch: 'accounts.spec.ts',
  globalSetup: './e2e/accounts.setup.ts',
  fullyParallel: false,
  workers: 1,
  use: { baseURL: 'http://localhost:4173', trace: 'retain-on-failure' },
  // Spec §13's matrix; E2E_PROJECTS picks (CI runs one project per job, Chromium alone locally).
  projects: selectProjects(process.env['E2E_PROJECTS']),
  webServer: {
    command: 'pnpm build && pnpm preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})
