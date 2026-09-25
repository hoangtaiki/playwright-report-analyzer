import { test, expect } from '@playwright/test';

// Produces a REAL empty results[] array. Run under --max-failures=1 with
// workers: 1 and fullyParallel: false, so MF-01 trips the cap before anything
// else is dispatched and the queued tests are dropped with no result appended
// at all. They still appear in the report, because the JSON reporter
// serialises the static load-time suite tree.
test('MF-01: fails immediately and trips --max-failures', () => {
  expect(1).toBe(2);
});

test('MF-02: never dispatched, no result at all', () => {
  expect(1).toBe(1);
});

test('MF-03: never dispatched, no result at all', () => {
  expect(1).toBe(1);
});
