import { test, expect } from '@playwright/test';
import * as pkg from '../src/index.js';

test.describe('index barrel', () => {
  test('should re-export the public API', () => {
    expect(typeof pkg.extractFailedTests).toBe('function');
    expect(typeof pkg.analyze).toBe('function');
    expect(typeof pkg.extractSummary).toBe('function');
    expect(typeof pkg.extractRawStats).toBe('function');
    expect(typeof pkg.extractReportErrors).toBe('function');
    expect(typeof pkg.toGrepPattern).toBe('function');
  });
});
