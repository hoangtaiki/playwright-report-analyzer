import { test, expect } from '@playwright/test';

test.describe('Outer describe', () => {
  test.describe('Middle describe', () => {
    test.describe('Inner describe', () => {
      test('DEEP-01: fails four levels deep', () => {
        expect(1).toBe(2);
      });
    });
  });
});
