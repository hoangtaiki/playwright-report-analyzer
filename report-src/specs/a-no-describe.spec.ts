import { test, expect } from '@playwright/test';

test('Y-02: fails with no wrapping describe', () => {
  expect(1).toBe(2);
});
