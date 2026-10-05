import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      { test: { name: 'server', include: ['server/**/*.test.ts'], environment: 'node' } },
      { test: { name: 'shared', include: ['shared/**/*.test.ts'], environment: 'node' } },
      { test: { name: 'ui', include: ['src/**/*.test.tsx'], environment: 'happy-dom' } },
    ],
  },
})
