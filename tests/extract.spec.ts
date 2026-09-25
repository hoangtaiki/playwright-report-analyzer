import { test, expect } from '@playwright/test';
import {
  extractFailedTests,
  analyze,
  extractSummary,
  extractRawStats,
  extractReportErrors,
} from '../src/extract.js';
import { REPORTS, reportPath, scratchPath } from './support/reports.js';

// Every report below is produced by REALLY running Playwright in global setup
// (tests/global-setup.ts): the real runner, the real blob reporter and the
// real `merge-reports` CLI. Nothing here is a stored snapshot, so a Playwright
// upgrade that changes the report schema fails these tests rather than
// silently passing against stale JSON.
//
// Assertions are on BEHAVIOUR, never on the exact shape of a report: the same
// inputs legitimately produce more than one valid report shape (see the
// merge-shape suite below).

const titlesOf = (failed: { titlePath: string[] }[]) =>
  failed.map(f => f.titlePath[f.titlePath.length - 1]);

test.describe('extractFailedTests - suite tree walking', () => {
  test('should find a failing spec with no wrapping describe, sorted first among its siblings', () => {
    // a-no-describe.spec.ts sorts before b-with-describe.spec.ts, so the
    // describe-less file is the FIRST suite walked.
    const failed = extractFailedTests(reportPath(REPORTS.structural));
    const titles = failed.map(f => f.title);
    expect(titles).toContain(
      'a-no-describe.spec.ts > Y-02: fails with no wrapping describe'
    );
    expect(titles).toContain(
      'b-with-describe.spec.ts > X-01 describe block > X-01: fails inside a describe block'
    );
  });

  test('should find a failing spec with no wrapping describe, sorted last among its siblings', () => {
    // The opposite pairing: c-with-describe-2 sorts before d-no-describe-2.
    // This is the ordering that aborts save_failed_tests.sh's jq selector,
    // `.suites[].suites[].specs[]`, which iterates null on whichever suite has
    // no `suites` key. The extractor must not depend on order either way.
    const failed = extractFailedTests(reportPath(REPORTS.structural));
    const titles = failed.map(f => f.title);
    expect(titles).toContain(
      'c-with-describe-2.spec.ts > X-01-2 describe block > X-01-2: fails inside a describe block, sorted first'
    );
    expect(titles).toContain(
      'd-no-describe-2.spec.ts > Y-02-2: fails with no wrapping describe, sorted last'
    );
  });

  test('should find a failing spec nested four levels deep', () => {
    const failed = extractFailedTests(reportPath(REPORTS.structural));
    const deep = failed.find(f => f.title.includes('DEEP-01'));
    expect(deep).toBeDefined();
    expect(deep?.titlePath).toEqual([
      'deep-nesting.spec.ts',
      'Outer describe',
      'Middle describe',
      'Inner describe',
      'DEEP-01: fails four levels deep',
    ]);
  });
});

test.describe('extractFailedTests - multi-project reports', () => {
  test('should report a test that failed on one project even though it passed on the other', () => {
    const failed = extractFailedTests(reportPath(REPORTS.mergeMultiproject));
    const mrg01 = failed.filter(f => f.title.includes('MRG-01'));
    expect(mrg01).toHaveLength(1);
    expect(mrg01[0].project).toBe('project-b');
  });

  test('should report both projects when a spec fails on every project', () => {
    const failed = extractFailedTests(reportPath(REPORTS.mergeMultiproject));
    const mrg03 = failed.filter(f => f.title.includes('MRG-03'));
    expect(mrg03.map(f => f.project).sort()).toEqual([
      'project-a',
      'project-b',
    ]);
  });

  test('should narrow to a single project when the projects option is given', () => {
    const failed = extractFailedTests(reportPath(REPORTS.mergeMultiproject), {
      projects: ['project-b'],
    });
    expect(failed.length).toBeGreaterThan(0);
    expect(failed.every(f => f.project === 'project-b')).toBe(true);
  });
});

test.describe('extractFailedTests - reruns merged back in', () => {
  // Both reports below come from the SAME two blobs: an initial run, plus an
  // IS_RERUN `--grep` rerun of the tests that failed - NF's own CI flow. They
  // differ only in the working directory `merge-reports` ran from, which is
  // what decides whether Playwright combines the duplicate spec entries or
  // leaves them separate (see groupByProject's doc comment).
  const shapes = [
    ['Playwright left the entries unmerged', REPORTS.mergeRerunUnmerged],
    ['Playwright merged the entries', REPORTS.mergeRerunMerged],
  ] as const;

  for (const [shape, report] of shapes) {
    test(`should NOT report a test that failed initially but passed on the rerun, when ${shape}`, () => {
      const failed = extractFailedTests(reportPath(report));
      expect(titlesOf(failed).filter(t => t.includes('MRG-02'))).toHaveLength(
        0
      );
    });

    test(`should report a still-failing test exactly once, when ${shape}`, () => {
      const failed = extractFailedTests(reportPath(report));
      const mrg04 = failed.filter(f => f.title.includes('MRG-04'));
      expect(mrg04).toHaveLength(1);
      // Two TestCase entries, one attempt each, so two attempts in total.
      // A naive per-TestCase read, or one that trusted Playwright to have
      // merged them, would report 0 here.
      expect(mrg04[0].retries).toBe(1);
    });
  }

  test('should extract identically from both shapes, since both came from the same blobs', () => {
    // The strongest guarantee in the suite: the report shape is Playwright's
    // business, the extracted result is ours, and it must not vary with it.
    expect(extractFailedTests(reportPath(REPORTS.mergeRerunUnmerged))).toEqual(
      extractFailedTests(reportPath(REPORTS.mergeRerunMerged))
    );
  });

  test('should surface the cleared test as flaky when includeFlaky is set', () => {
    const failed = extractFailedTests(reportPath(REPORTS.mergeRerunUnmerged), {
      includeFlaky: true,
    });
    const mrg02 = failed.filter(f => f.title.includes('MRG-02'));
    expect(mrg02).toHaveLength(1);
    expect(mrg02[0].status).toBe('passed');
  });
});

test.describe('extractFailedTests - status of the final attempt', () => {
  test('should report an ordinary failure as failed', () => {
    const failed = extractFailedTests(reportPath(REPORTS.structural));
    expect(failed.find(f => f.title.includes('ST-01'))?.status).toBe('failed');
  });

  test('should report a timeout as timedOut', () => {
    const failed = extractFailedTests(reportPath(REPORTS.structural));
    expect(failed.find(f => f.title.includes('ST-02'))?.status).toBe(
      'timedOut'
    );
  });

  test('should report a test.fail()-annotated test that unexpectedly passed, with status passed', () => {
    const failed = extractFailedTests(reportPath(REPORTS.structural));
    const st03 = failed.find(f => f.title.includes('ST-03'));
    expect(st03).toBeDefined();
    expect(st03?.status).toBe('passed');
  });

  test('should report a retry abandoned mid-suite as skipped', () => {
    // AR-02 failed, then never ran again because the serial suite's first
    // test failed on the retry: results are [failed, skipped].
    const failed = extractFailedTests(reportPath(REPORTS.abandonedRetry));
    const ar02 = failed.find(f => f.title.includes('AR-02'));
    expect(ar02?.status).toBe('skipped');
    expect(ar02?.retries).toBe(1);
  });

  test('should report a retry interrupted after an earlier failure as interrupted', () => {
    // IN-02 failed, then its retry was cut short by the failure cap:
    // results are [failed, interrupted].
    const failed = extractFailedTests(reportPath(REPORTS.interrupted));
    const in02 = failed.find(f => f.title.includes('IN-02'));
    expect(in02?.status).toBe('interrupted');
    expect(in02?.retries).toBe(1);
  });

  test('should carry the error message and duration of the final attempt', () => {
    const failed = extractFailedTests(reportPath(REPORTS.structural));
    const st01 = failed.find(f => f.title.includes('ST-01'));
    expect(st01?.error).toContain('toBe');
    // `error` is the first line only; `errorStack` keeps the rest.
    expect(st01?.error).not.toContain('\n');
    expect(st01?.errorStack).toContain('statuses.spec.ts');
    expect(st01?.duration).toBeGreaterThanOrEqual(0);
  });
});

test.describe('extractFailedTests - tests that must NOT be reported', () => {
  test('should exclude a flaky test by default and include it with includeFlaky', () => {
    const report = reportPath(REPORTS.structural);
    expect(
      extractFailedTests(report).find(f => f.title.includes('ST-08'))
    ).toBeUndefined();

    const st08 = extractFailedTests(report, { includeFlaky: true }).find(f =>
      f.title.includes('ST-08')
    );
    expect(st08?.status).toBe('passed');
    expect(st08?.retries).toBe(1);
  });

  test('should exclude a test that never ran at all, with no result recorded', () => {
    // MF-02 and MF-03 were dropped from the queue when the failure cap
    // tripped, so their `results` arrays are empty. Playwright scores that
    // outcome as skipped, not unexpected.
    const failed = extractFailedTests(reportPath(REPORTS.maxFailures));
    expect(titlesOf(failed).some(t => t.includes('MF-02'))).toBe(false);
    expect(titlesOf(failed).some(t => t.includes('MF-03'))).toBe(false);
    expect(titlesOf(failed).some(t => t.includes('MF-01'))).toBe(true);
  });

  test('should exclude a test interrupted on its only attempt', () => {
    // IN-03 would have passed; it was interrupted before finishing, with no
    // earlier failure, so its outcome is skipped rather than unexpected.
    const failed = extractFailedTests(reportPath(REPORTS.interrupted));
    expect(titlesOf(failed).some(t => t.includes('IN-03'))).toBe(false);
  });
});

test.describe('extractRawStats', () => {
  test('should read the stats block from a real report', () => {
    const stats = extractRawStats(reportPath(REPORTS.structural));
    expect(stats.flaky).toBe(1);
    expect(stats.unexpected).toBeGreaterThan(0);
    expect(stats.duration).toBeGreaterThan(0);
    expect(Number.isNaN(Date.parse(stats.startTime))).toBe(false);
  });

  test('should reconcile with the extracted count when no (spec, project) has more than one entry', () => {
    const report = reportPath(REPORTS.structural);
    expect(extractFailedTests(report)).toHaveLength(
      extractRawStats(report).unexpected
    );
  });

  test('should NOT reconcile once a rerun has been merged in', () => {
    // stats.unexpected counts every unexpected TestCase entry separately,
    // while the extraction groups them. These are expected to disagree, so
    // stats is not a correctness cross-check on a merged report.
    const report = reportPath(REPORTS.mergeRerunUnmerged);
    expect(extractRawStats(report).unexpected).toBeGreaterThan(
      extractFailedTests(report).length
    );
  });

  test('should return zeroed counts for a run that matched no tests', () => {
    const stats = extractRawStats(reportPath(REPORTS.empty));
    expect(stats.expected).toBe(0);
    expect(stats.unexpected).toBe(0);
    expect(stats.flaky).toBe(0);
    expect(stats.skipped).toBe(0);
  });
});

test.describe('analyze / extractSummary - computed totals', () => {
  // merge-rerun.spec.ts (both merge shapes) is exactly two tests, no
  // retries, so every number below is pinned:
  //   MRG-02: fails on the initial run, passes on the rerun -> flaky
  //   MRG-04: fails on the initial run AND the rerun -> failed, once
  // Playwright's raw stats sum to 4 entries (1 expected + 3 unexpected);
  // the real answer is 2 tests, one failed, one flaky.

  for (const reportName of [
    REPORTS.mergeRerunUnmerged,
    REPORTS.mergeRerunMerged,
  ] as const) {
    test.describe(`against ${reportName}`, () => {
      test('should score the rerun-cleared test as flaky, which raw stats cannot', () => {
        // computeTestCaseOutcome only ever reads one TestCase's own
        // results[], and merge-reports keeps the initial run and the rerun
        // as two separate single-result TestCases (mergeTestCases: false).
        // The 'flaky' branch is unreachable there, so raw stats.flaky is
        // always 0 across a rerun merge - grouping is what recovers it.
        const report = reportPath(reportName);
        expect(extractRawStats(report).flaky).toBe(0);
        expect(analyze(report).summary.flaky).toBe(1);
      });

      test('should collapse a test that failed on both the initial run and the rerun into ONE failure, not two', () => {
        const report = reportPath(reportName);
        expect(extractRawStats(report).unexpected).toBe(3);
        expect(analyze(report).summary.failed).toBe(1);
      });

      test('should not count the rerun-cleared test as a distinct passing test', () => {
        // Playwright's raw `expected: 1` is the rerun's own half of MRG-02,
        // not a third, separately-passing test.
        const report = reportPath(reportName);
        expect(extractRawStats(report).expected).toBe(1);
        expect(analyze(report).summary.passed).toBe(0);
      });

      test('should count 2 distinct tests total, not the 4 TestCase entries Playwright produced', () => {
        const report = reportPath(reportName);
        const raw = extractRawStats(report);
        const bucketSum =
          raw.expected + raw.unexpected + raw.flaky + raw.skipped;
        expect(bucketSum).toBe(4);
        expect(analyze(report).summary.total).toBe(2);
      });

      test('should report the still-failing test but not the flaky-cleared one, by default', () => {
        const { failed } = analyze(reportPath(reportName));
        const titles = failed.map(f => f.titlePath[f.titlePath.length - 1]);
        expect(titles.some(t => t?.includes('MRG-04'))).toBe(true);
        expect(titles.some(t => t?.includes('MRG-02'))).toBe(false);
      });

      test('should mark the build not-ok', () => {
        expect(analyze(reportPath(reportName)).summary.ok).toBe(false);
      });
    });
  }

  test('should partition total into passed + failed + flaky + skipped on a plain run', () => {
    const { summary } = analyze(reportPath(REPORTS.structural));
    expect(
      summary.passed + summary.failed + summary.flaky + summary.skipped
    ).toBe(summary.total);
  });

  test('failed.length should reconcile with summary under both includeFlaky values', () => {
    const report = reportPath(REPORTS.mergeRerunUnmerged);
    const strict = analyze(report, { includeFlaky: false });
    expect(strict.failed.length).toBe(strict.summary.failed);

    const lenient = analyze(report, { includeFlaky: true });
    expect(lenient.failed.length).toBe(
      lenient.summary.failed + lenient.summary.flaky
    );
  });

  test('should return an all-zero, ok summary for a run that matched no tests', () => {
    const { summary } = analyze(reportPath(REPORTS.empty));
    expect(summary.total).toBe(0);
    expect(summary.passed).toBe(0);
    expect(summary.failed).toBe(0);
    expect(summary.flaky).toBe(0);
    expect(summary.skipped).toBe(0);
    expect(summary.ok).toBe(true);
  });

  test('should count per (spec, project), not per spec, on a multi-project report', () => {
    const { summary } = analyze(reportPath(REPORTS.mergeMultiproject));
    // 2 specs x 2 projects = 4 groups. MRG-01 passes on project-a, fails on
    // project-b; MRG-03 fails on both -> 1 passed, 3 failed, 4 total.
    expect(summary.total).toBe(4);
    expect(summary.passed).toBe(1);
    expect(summary.failed).toBe(3);
  });

  test('should mark zero failed but not-ok when the report has top-level errors', () => {
    const { summary } = analyze(reportPath(REPORTS.reportErrors));
    expect(summary.failed).toBe(0);
    expect(summary.reportErrors).toBeGreaterThan(0);
    expect(summary.ok).toBe(false);
  });

  test('extractSummary should be a thin wrapper over analyze().summary', () => {
    const report = reportPath(REPORTS.mergeRerunUnmerged);
    expect(extractSummary(report)).toEqual(analyze(report).summary);
  });
});

test.describe('extractReportErrors', () => {
  test('should surface a spec file that failed to import, with zero failed specs', () => {
    const report = reportPath(REPORTS.reportErrors);
    // The catastrophic case: nothing failed, because nothing could run.
    expect(extractFailedTests(report)).toHaveLength(0);
    const errors = extractReportErrors(report);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.map(e => e.message).join('\n')).toContain(
      'playwright-report-analyzer-nonexistent-fixture-helper'
    );
  });

  test('should return an empty array when a run produced no top-level errors', () => {
    expect(extractReportErrors(reportPath(REPORTS.empty))).toEqual([]);
  });
});

test.describe('extractFailedTests - input handling', () => {
  test('should return an empty array for a run that matched no tests', () => {
    expect(extractFailedTests(reportPath(REPORTS.empty))).toEqual([]);
  });

  test('should accept an already-parsed report object', () => {
    const report = JSON.parse(
      JSON.stringify({
        suites: [],
        errors: [],
        stats: {
          startTime: '',
          duration: 0,
          expected: 0,
          unexpected: 0,
          flaky: 0,
          skipped: 0,
        },
      })
    );
    expect(extractFailedTests(report)).toEqual([]);
  });

  test('should throw a clear error for a missing report file', () => {
    expect(() =>
      extractFailedTests(scratchPath('does-not-exist.json'))
    ).toThrow(/could not read report/);
  });

  test('should throw a clear error for a file that is not JSON', () => {
    expect(() => extractFailedTests(scratchPath('not-a-report.json'))).toThrow(
      /not valid JSON/
    );
  });
});
