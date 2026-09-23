import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['test/globalSetup.ts'],
    setupFiles: ['test/setup.ts'],
    // One database: files run one at a time, and every test starts from empty tables.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
