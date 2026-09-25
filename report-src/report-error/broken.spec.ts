import { test } from '@playwright/test';
// Intentionally broken import - this file must fail to load, producing a
// top-level `errors[]` entry in the JSON report rather than a failed spec.
import 'playwright-report-analyzer-nonexistent-fixture-helper';

test('unreachable', () => {});
