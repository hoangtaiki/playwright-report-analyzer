import { defineConfig } from '@playwright/test';

// generate.mjs runs this config TWICE under the same (default) project - an
// initial full run, then an IS_RERUN=1 run of just the previously-failed
// tests - each with the blob reporter to its own output dir, then combines
// both with `playwright merge-reports`. This reproduces NF's actual
// save_failed_tests.sh -> --grep -> merge-reports flow.
export default defineConfig({
  testDir: './specs',
  testMatch: '**/merge-rerun.spec.ts',
  fullyParallel: true,
  reporter: [['blob', {}]],
});
