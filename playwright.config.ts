import { defineConfig } from '@playwright/test';

// This package has no browser runtime coupling - Playwright Test is used purely
// as the unit-test runner for a Node library, so there is a single default
// project and no `devices` import, matching the `@playwright/test` devDependency
// (not peerDependency) declared in package.json.
//
// globalSetup produces every report the suite asserts against by really running
// Playwright against the specs in report-src/. That is slow, and deliberately
// so: the alternative is committing snapshots, which stops the suite testing
// the installed Playwright. Set SKIP_REPORT_GEN=1 to reuse the previous run's
// reports while iterating locally.
export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  globalSetup: './tests/global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.CI ? 1 : undefined,
  // Report generation runs several nested Playwright invocations, one of which
  // deliberately waits out a failure cap.
  timeout: 120_000,
  reporter: [['html', { outputFolder: './playwright-report' }], ['list']],
});
