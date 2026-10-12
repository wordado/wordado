import { defineConfig } from '@playwright/test'
import { selectProjects } from './e2e/projects'

export default defineConfig({
  testDir: 'e2e',
  testMatch: 'demo.spec.ts',
  // One worker, so the tests run one after the other as they always have. `fullyParallel` is here for CI,
  // which runs the file as two halves in two jobs (--shard): a file is split only when its tests may run apart.
  fullyParallel: true,
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
