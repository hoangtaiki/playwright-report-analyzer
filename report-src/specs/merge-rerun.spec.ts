import { test, expect } from '@playwright/test';

// Run via two SEPARATE invocations under the SAME (default) project: an
// initial full run, then a `--grep` rerun of just the tests that failed -
// exactly NF's own save_failed_tests.sh -> --grep flow - each with the blob
// reporter to its own output dir, then combined with
// `playwright merge-reports`. IS_RERUN distinguishes the two invocations
// without any shared filesystem state, so generation is fully idempotent.

test('MRG-02: same project, failed on the initial run, passed on the rerun', () => {
  if (process.env.IS_RERUN) {
    expect(1).toBe(1);
  } else {
    expect(1).toBe(2);
  }
});

test('MRG-04: same project, still fails on the initial run and the rerun', () => {
  expect(1).toBe(2);
});
