import { defineConfig } from '@playwright/test'
import { COURSES_URL } from './e2e/courses'
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
  webServer: [
    {
      command: 'pnpm build && pnpm preview',
      url: 'http://localhost:4173',
      // English alone, as a build without the variable offers, whatever the shell has set.
      env: { VITE_COURSE_TARGETS: '' },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      // The two-course build (#313): English and German offered, in its own folder and on its own port. The tests
      // of a second course open it through `test.use({ baseURL: COURSES_URL })`; every other test stays on the
      // English-only build above.
      command: 'pnpm exec vite build --outDir dist-courses && pnpm exec vite preview --outDir dist-courses --port 4174',
      url: COURSES_URL,
      env: { VITE_COURSE_TARGETS: 'en,de' },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
})
