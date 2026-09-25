import { defineConfig } from '@playwright/test';

// `maxFailures: 1` with `retries: 1` is what produces a real 'interrupted'
// result: the failure tracker only counts a test's FINAL attempt, so the cap
// trips on IN-01's retry while the other specs are still running, and the
// dispatcher rewrites their status as they finish. Three workers so all three
// specs are genuinely in flight together.
export default defineConfig({
  testDir: './specs',
  testMatch: '**/interrupted.spec.ts',
  fullyParallel: true,
  workers: 3,
  retries: 1,
  maxFailures: 1,
  reporter: [['json']],
});
