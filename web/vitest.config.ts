import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  optimizeDeps: { exclude: ['@journeyapps/wa-sqlite'] },
  worker: { format: 'es' },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.test.{ts,tsx}', 'vite/**/*.test.ts', 'e2e/**/*.test.ts'],
          exclude: ['src/**/*.browser.test.ts'],
          environment: 'happy-dom',
          // A limit for a hang, not a speed requirement. Many of these tests open
          // real SQLite files, install the sample pack and sync against a fake
          // server; idle the slowest takes under 0.1 s, and under local load
          // (every core busy, four workers) about 1 s. On a CI runner running the
          // browser project and a Docker pull beside it, one ran out the 5 s
          // default (5.5 s), before the files skipped their fsyncs. 20 s is about
          // four times that worst case.
          testTimeout: 20_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'browser',
          include: ['src/**/*.browser.test.ts'],
          browser: { enabled: true, headless: true, provider: playwright(), instances: [{ browser: 'chromium' }] },
          // A limit for a hang, as in `unit`. Idle or under local load the slowest
          // storage test takes under 0.4 s, beside TabLock's timer-bound ones
          // (1.8 s by design); on a loaded CI runner an IndexedDB erase took 4 s,
          // too near the 5 s default.
          testTimeout: 20_000,
        },
      },
    ],
  },
})
