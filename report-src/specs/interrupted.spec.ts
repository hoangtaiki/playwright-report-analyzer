import { test, expect } from '@playwright/test';

// Produces real 'interrupted' results. The writer is the dispatcher's
// max-failures overwrite, not a global timeout: once the failure cap is
// reached, `_onTestEnd` rewrites the status of every test that finishes
// afterwards to 'interrupted'. (A global timeout instead force-kills workers
// that are still mid-test, and the parent synthesises plain 'skipped'.)
//
// The failure tracker only counts a FINAL attempt, so with `retries: 1` the
// cap trips on IN-01's retry. The other two specs are still in flight then and
// finish afterwards, on their own, well inside the teardown budget.
//
// IN-01 fails on both attempts, tripping the cap:  [failed@0, failed@1]
// IN-02 fails, then its retry is interrupted:      [failed@0, interrupted@1]
//   -> outcome 'unexpected' -> MUST be reported, with status 'interrupted'.
// IN-03 would have passed, but is interrupted:     [interrupted@0]
//   -> outcome 'skipped'    -> must NOT be reported.
const TRIP_CAP_MS = 2000;
const AFTER_CAP_MS = 5000;
const WELL_AFTER_CAP_MS = 6000;

async function sleep(ms: number) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

test('IN-01: fails on both attempts, tripping the failure cap', async () => {
  test.setTimeout(0);
  if (test.info().retry > 0) await sleep(TRIP_CAP_MS);
  expect(1).toBe(2);
});

test('IN-02: fails, then its retry is interrupted by the cap', async () => {
  test.setTimeout(0);
  if (test.info().retry > 0) await sleep(AFTER_CAP_MS);
  expect(1).toBe(2);
});

test('IN-03: interrupted on its only attempt', async () => {
  test.setTimeout(0);
  await sleep(WELL_AFTER_CAP_MS);
  expect(1).toBe(1);
});
