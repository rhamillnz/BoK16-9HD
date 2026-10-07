import { defineConfig } from 'vitest/config';

// End-to-end smoke tests: a real browser against the synthetic harness (see docs/e2e.md).
// Not part of `vitest run`; use `npm run test:e2e`.
export default defineConfig({
  test: {
    include: ['e2e/**/*.e2e.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
