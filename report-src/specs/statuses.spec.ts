import { test, expect } from '@playwright/test';

test('ST-01: ordinary failure', () => {
  expect(1).toBe(2);
});

test('ST-02: times out', async () => {
  test.setTimeout(50);
  await new Promise(resolve => setTimeout(resolve, 5000));
});

test('ST-03: test.fail() annotated test that unexpectedly passes', () => {
  test.fail();
  expect(1).toBe(1);
});
