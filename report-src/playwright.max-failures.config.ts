import { defineConfig } from '@playwright/test';

// One worker, no parallelism, and a failure cap of 1: the first test trips the
// cap before anything else is dispatched, so the remaining tests are dropped
// from the queue with NO result appended - an empty results[] array, which is
// the only real way Playwright emits a test entry with no result status.
export default defineConfig({
  testDir: './specs',
  testMatch: '**/max-failures.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  maxFailures: 1,
  reporter: [['json']],
});
