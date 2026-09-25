import { defineConfig } from '@playwright/test';

// A spec file that fails to import, producing a top-level report error with
// zero failed specs.
export default defineConfig({
  testDir: './report-error',
  reporter: [['json']],
});
