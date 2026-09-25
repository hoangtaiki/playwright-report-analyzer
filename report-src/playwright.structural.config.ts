import { defineConfig } from '@playwright/test';

// Single run - the ordering, nesting and ordinary-status scenarios are all
// visible directly in one JSON reporter run. `flaky.spec.ts` is routed to its
// own project so only IT gets `retries: 1`; every other spec here must fail on
// its one and only attempt. The scenario specs that need their own runner
// flags (serial retries, max-failures, a global timeout) are excluded.
export default defineConfig({
  testDir: './specs',
  fullyParallel: true,
  reporter: [['json']],
  projects: [
    {
      name: 'default',
      testIgnore: [
        '**/flaky.spec.ts',
        '**/merge-*.spec.ts',
        '**/abandoned-retry.spec.ts',
        '**/max-failures.spec.ts',
        '**/interrupted.spec.ts',
      ],
      retries: 0,
    },
    {
      name: 'retry',
      testMatch: '**/flaky.spec.ts',
      retries: 1,
    },
  ],
});
