import { test, expect } from '@playwright/test';

test('Y-02-2: fails with no wrapping describe, sorted last', () => {
  expect(1).toBe(2);
});
