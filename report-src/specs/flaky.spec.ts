import { test, expect } from '@playwright/test';

// Run only under a project configured with retries: 1 (see
// playwright.structural.config.ts). Deterministic via test.info().retry rather
// than any shared/file-based state.
test('ST-08: flaky - failed then passed on retry', () => {
  expect(test.info().retry).toBeGreaterThan(0);
});
