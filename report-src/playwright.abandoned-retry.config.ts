import { defineConfig } from '@playwright/test';

// `retries: 1` plus a serial describe is what makes a retry attempt get
// abandoned: when the suite's first test fails on the retry, the second never
// runs and is mass-skipped with an empty error list, which the dispatcher
// records as a real results[] entry with status 'skipped' at retry 1.
export default defineConfig({
  testDir: './specs',
  testMatch: '**/abandoned-retry.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 1,
  reporter: [['json']],
});
