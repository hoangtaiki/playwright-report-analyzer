import { test, expect } from '@playwright/test';

// Produces a REAL abandoned retry: a results[] entry with status 'skipped' at
// retry >= 1. Requires a serial describe plus `retries: 1`.
//
// Run 0:  AR-01 passes, AR-02 fails            -> AR-02 gets [failed@0]
// Retry:  AR-01 fails, so AR-02 never runs     -> AR-02 gets [failed@0, skipped@1]
//
// AR-01 must pass first and fail only on the retry, otherwise there is no
// second pass for AR-02 to be abandoned in. dispatcher.js writes
// `status = errors.length ? 'failed' : 'skipped'` for mass-skipped tests, and
// _appendTestResult stamps retry = results.length.
test.describe.serial('AR serial suite', () => {
  test('AR-01: passes first time, fails on the retry', () => {
    expect(test.info().retry).toBe(0);
  });

  test('AR-02: fails first time, then never runs on the retry', () => {
    expect(1).toBe(2);
  });
});
