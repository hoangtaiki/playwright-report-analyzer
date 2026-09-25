// Export the extraction and grep-pattern APIs
export {
  extractFailedTests,
  analyze,
  extractSummary,
  extractRawStats,
  extractReportErrors,
} from './extract.js';
export type {
  FailedTest,
  ExtractOptions,
  TestSummary,
  AnalyzeResult,
  RawStats,
  ReportErrorSummary,
} from './extract.js';
export { toGrepPattern } from './grep.js';
export type { GrepOptions } from './grep.js';

// Re-export the report schema types for consumers that want to work with the
// raw JSON report directly
export type {
  PlaywrightJSONReport,
  ReportSuite,
  ReportSpec,
  ReportTestCase,
  ReportTestResult,
  ReportStats,
  ReportError,
  ReportAttachment,
  ReportStep,
  ReportTestStatus,
  ReportTestCaseStatus,
} from './types.js';
