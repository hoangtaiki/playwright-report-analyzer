import { test, expect } from '@playwright/test';

// Named to sort alphabetically BEFORE d-no-describe-2.spec.ts, so this pairing
// produces the opposite suite ordering from a/b - i.e. the describe-less file
// sorts LAST. That is exactly the ordering that aborts save_failed_tests.sh's
// `jq` selector (`.suites[].suites[].specs[]` iterating null on whichever
// suite has no `suites` key) once it reaches the describe-less file.
test.describe('X-01-2 describe block', () => {
  test('X-01-2: fails inside a describe block, sorted first', () => {
    expect(1).toBe(2);
  });
});
