import { test, expect } from '@playwright/test';

test.describe('X-01 describe block', () => {
  test('X-01: fails inside a describe block', () => {
    expect(1).toBe(2);
  });
});
