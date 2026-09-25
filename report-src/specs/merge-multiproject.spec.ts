import { test, expect } from '@playwright/test';

// Run via two SEPARATE `playwright test --project=...` invocations (see
// generate.mjs), each with the blob reporter to its own output dir, then
// combined with `playwright merge-reports` - not a single multi-project
// run. A single run's own JSON reporter does NOT merge same-titled specs
// across projects into one spec's tests[] array (confirmed empirically);
// only merge-reports does that.

test('MRG-01: passes on project-a, fails on project-b', () => {
  expect(test.info().project.name).not.toBe('project-b');
});

test('MRG-03: fails on both projects', () => {
  expect(1).toBe(2);
});
