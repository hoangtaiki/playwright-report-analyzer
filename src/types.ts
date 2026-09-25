// Types for the Playwright JSON report, mirroring `@playwright/test`'s
// `testReporter.d.ts` (verified against Playwright 1.58.2). Kept local rather
// than imported so this package has no runtime dependency on Playwright.

/** Outcome of a single attempt. Declared `| undefined` upstream - an attempt
 *  that never produced a status must be handled, not assumed away. */
export type ReportTestStatus =
  'passed' | 'failed' | 'timedOut' | 'skipped' | 'interrupted' | undefined;

/** Outcome of a TestCase across all its attempts (`test.outcome()`). */
export type ReportTestCaseStatus =
  'skipped' | 'expected' | 'unexpected' | 'flaky';

export interface ReportError {
  message?: string;
  stack?: string;
  value?: string;
  snippet?: string;
  location?: { file: string; line: number; column: number };
}

export interface ReportAttachment {
  name: string;
  contentType: string;
  path?: string;
  body?: string;
}

export interface ReportStep {
  title: string;
  duration: number;
  error?: ReportError;
  steps?: ReportStep[];
}

export interface ReportTestResult {
  status: ReportTestStatus;
  duration: number;
  retry: number;
  startTime?: string;
  error?: ReportError;
  errors?: ReportError[];
  attachments?: ReportAttachment[];
  steps?: ReportStep[];
  stdout?: unknown[];
  stderr?: unknown[];
  parallelIndex?: number;
  workerIndex?: number;
}

export interface ReportTestCase {
  projectId?: string;
  projectName?: string;
  status: ReportTestCaseStatus;
  expectedStatus?: string;
  timeout?: number;
  annotations?: { type: string; description?: string }[];
  results: ReportTestResult[];
}

export interface ReportSpec {
  title: string;
  ok: boolean;
  tags?: string[];
  id?: string;
  file?: string;
  line?: number;
  column?: number;
  tests: ReportTestCase[];
}

export interface ReportSuite {
  title: string;
  file?: string;
  line?: number;
  column?: number;
  specs: ReportSpec[];
  // Optional - Playwright omits this key entirely when a suite has no
  // children (json.js: `suites: suites.length ? suites : void 0`). Any walk
  // that assumes it is always present breaks on a describe-less spec file.
  suites?: ReportSuite[];
}

export interface ReportStats {
  startTime: string;
  duration: number;
  expected: number;
  unexpected: number;
  flaky: number;
  skipped: number;
}

export interface PlaywrightJSONReport {
  config?: unknown;
  suites: ReportSuite[];
  errors?: ReportError[];
  stats: ReportStats;
}
