import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // React plugin so .tsx renderer tests can import components and JSX.
  // No-op for plain .ts test files (the bulk of the suite).
  plugins: [react()],
  test: {
    globals: true,
    // Per-file environment override via /** @vitest-environment jsdom */
    // pragma at the top of component-render tests. Default stays ``node``
    // so the existing 1800+ tests don't pay the jsdom startup cost.
    environment: 'node',
    // Electron app test surface — TypeScript only, anywhere under src/.
    include: ['src/**/*.test.{ts,tsx}'],
    // Defensive exclusions: electron has its own src/ tree so it should
    // never reach into out/, dist/, or node_modules — but make it explicit
    // so a future src-adjacent path can't accidentally drag tests in.
    exclude: [
      'node_modules/**',
      'out/**',
      'dist/**',
      'build/**',
    ],
  },
})
