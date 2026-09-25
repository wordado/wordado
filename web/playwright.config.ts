import { defineConfig } from '@playwright/test'
import { selectProjects } from './e2e/projects'

export default defineConfig({
  testDir: 'e2e',
  testMatch: 'demo.spec.ts',
  fullyParallel: false,
  workers: 1,
  use: { baseURL: 'http://localhost:4173', trace: 'retain-on-failure' },
  // Spec §13's matrix; E2E_PROJECTS picks (CI runs one project per job, Chromium alone locally).
  projects: selectProjects(process.env['E2E_PROJECTS']),
  webServer: {
    command: 'pnpm build && pnpm preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
