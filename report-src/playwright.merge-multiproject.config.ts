import { defineConfig } from '@playwright/test';

// generate.mjs runs this config TWICE, once per --project, each with the
// blob reporter to its own output dir, then combines both with
// `playwright merge-reports` - reproducing exactly how a real multi-project
// (e.g. chromium vs webkit) report gets merged.
export default defineConfig({
  testDir: './specs',
  testMatch: '**/merge-multiproject.spec.ts',
  fullyParallel: true,
  reporter: [['blob', {}]],
  projects: [{ name: 'project-a' }, { name: 'project-b' }],
});
