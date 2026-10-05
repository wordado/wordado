import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      { test: { name: 'server', include: ['server/**/*.test.ts', 'scripts/**/*.test.ts'], environment: 'node' } },
      { test: { name: 'shared', include: ['shared/**/*.test.ts'], environment: 'node' } },
      { test: { name: 'ui', include: ['src/**/*.test.ts', 'src/**/*.test.tsx'], environment: 'happy-dom' } },
      { test: { name: 'worker', include: ['worker/**/*.test.ts'], environment: 'node', testTimeout: 30_000, hookTimeout: 60_000 } },
    ],
  },
})
