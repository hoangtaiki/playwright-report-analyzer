import { readFileSync } from 'node:fs';
import type {
  PlaywrightJSONReport,
  ReportSpec,
  ReportSuite,
  ReportTestCase,
  ReportTestResult,
  ReportStats,
} from './types.js';

// --- Public types ---

export interface FailedTest {
  /** Full title path joined by ' > ' (file > describe > ... > test) */
  title: string;
  /** The same path unjoined; the test's own title is the last element */
  titlePath: string[];
  file?: string;
  line?: number;
  column?: number;
  project?: string;
  /** Playwright tags on the spec, without the leading '@' */
  tags: string[];
  /** First line of the error message (default: undefined when absent) */
  error?: string;
  /** Full error message including stack, when present */
  errorStack?: string;
  /** Duration of the most recent attempt, in ms */
  duration?: number;
  /** Total attempts across every TestCase entry for this (spec, project),
   *  minus 1 - i.e. 0 means it failed on the only attempt seen anywhere in
   *  the report. Unifies two distinct sources of multiple attempts: native
   *  Playwright retries (`retries: N` in config - one TestCase, several
   *  `results[]` entries) and NF's own rerun-and-merge pattern (a separate
   *  `playwright test --grep` invocation whose blob is later combined via
   *  `merge-reports` - a second, independent TestCase entry under the same
   *  project). Both inflate this count identically. */
  retries: number;
  /** Status of the final attempt. 'passed' means a test.fail()-annotated test
   *  that unexpectedly passed - still a failure. A raw status of `undefined`
   *  normalises to 'failed'. */
  status: 'failed' | 'timedOut' | 'interrupted' | 'passed' | 'skipped';
}

export interface ExtractOptions {
  /** Include flaky (failed, then passed on retry) tests (default: false) */
  includeFlaky?: boolean;
  /** Only include failures from these project names (default: all projects) */
  projects?: string[];
}

/** Playwright's own `stats` block, verbatim - see `extractRawStats` for why
 *  this is unsafe as a correctness check on a merged report. */
export interface RawStats {
  expected: number;
  unexpected: number;
  flaky: number;
  skipped: number;
  duration: number;
  startTime: string;
}

/** Net outcome of every (spec, project) group in the report, tallied by the
 *  same walk `extractFailedTests` uses - so this can never disagree with the
 *  failed list. `total`, `passed`, `failed`, `flaky` and `skipped` are a
 *  strict partition: `passed + failed + flaky + skipped === total`, always,
 *  regardless of `includeFlaky` (that option only changes which groups land
 *  in `analyze().failed`, never how they are tallied here). */
export interface TestSummary {
  /** Distinct (spec, project) executions - not a count of TestCase entries,
   *  which a rerun-merge can inflate (see `groupOutcome`'s doc comment). */
  total: number;
  passed: number;
  /** Net still-failing groups - every attempt anywhere in the report was
   *  unexpected. Equals `extractFailedTests(source).length` when
   *  `includeFlaky` is false; add `flaky` to reconcile when it is true. */
  failed: number;
  flaky: number;
  skipped: number;
  /** Wall-clock-ish duration from the report's own `stats` block. On a
   *  merged report this is the sum across blobs, not elapsed time. */
  duration: number;
  startTime: string;
  /** Top-level `errors[].length` - config/compile errors, e.g. a spec file
   *  that failed to import. These produce zero failed groups and a non-zero
   *  Playwright exit code, so `failed === 0` alone is not "the build is
   *  green"; check `ok`. */
  reportErrors: number;
  /** `failed === 0 && reportErrors === 0`. The single field a caller should
   *  branch a pass/fail Slack message on. */
  ok: boolean;
}

export interface AnalyzeResult {
  summary: TestSummary;
  failed: FailedTest[];
}

export interface ReportErrorSummary {
  message?: string;
  stack?: string;
}

const defaultOptions: Required<ExtractOptions> = {
  includeFlaky: false,
  projects: [],
};

// --- Report loading ---

/**
 * Load a Playwright JSON report from a file path, or pass an already-parsed
 * report object straight through.
 * @throws when the file is missing or its content is not valid JSON.
 */
function loadReport(
  source: string | PlaywrightJSONReport
): PlaywrightJSONReport {
  if (typeof source !== 'string') {
    return source;
  }

  let raw: string;
  try {
    raw = readFileSync(source, 'utf-8');
  } catch (err) {
    throw new Error(
      `playwright-report-analyzer: could not read report at "${source}": ${(err as Error).message}`
    );
  }

  try {
    return JSON.parse(raw) as PlaywrightJSONReport;
  } catch (err) {
    throw new Error(
      `playwright-report-analyzer: "${source}" is not valid JSON: ${(err as Error).message}`
    );
  }
}

// --- Suite walk ---

/**
 * Recursively walk a suite tree, yielding every spec together with the
 * title path of the suites it is nested under. `suite.suites` is optional -
 * Playwright omits the key entirely when a suite has no children - so this
 * guards `suite.suites ?? []` rather than assuming a fixed depth. That fixed
 * depth assumption (`.suites[].suites[].specs[]`) is what makes the
 * equivalent `jq` selector abort on a describe-less spec file.
 */
function* walkSpecs(
  suite: ReportSuite,
  parentPath: string[]
): Generator<{ spec: ReportSpec; titlePath: string[] }> {
  const path = [...parentPath, suite.title];
  for (const spec of suite.specs ?? []) {
    yield { spec, titlePath: path };
  }
  for (const child of suite.suites ?? []) {
    yield* walkSpecs(child, path);
  }
}

/**
 * Combine every spec sharing an identical (titlePath, title, file, line,
 * column) into one, concatenating their `tests[]` arrays - undoing
 * Playwright's own merge tool when IT failed to combine them (see
 * `groupByProject`'s doc comment for why that happens).
 *
 * The key is deliberately Playwright's OWN key for "is this the same test":
 * `s.title === spec.title && s.file === <file> && s.line === spec.line &&
 * s.column === spec.column` (json.js:149), scoped to one suite's specs -
 * which here is the title path. The single difference is that Playwright
 * re-relativises a path that is already relative, and we compare the two
 * relative strings directly.
 *
 * A report Playwright merged successfully never holds two specs with the same
 * identity, so this is a no-op there.
 */
function mergeDuplicateSpecEntries(
  entries: { spec: ReportSpec; titlePath: string[] }[]
): { spec: ReportSpec; titlePath: string[] }[] {
  const byKey = new Map<string, { spec: ReportSpec; titlePath: string[] }>();
  const order: string[] = [];

  for (const entry of entries) {
    const key = JSON.stringify([
      entry.titlePath,
      entry.spec.title,
      entry.spec.file,
      entry.spec.line,
      entry.spec.column,
    ]);
    const existing = byKey.get(key);
    if (existing) {
      existing.spec.tests = [
        ...(existing.spec.tests ?? []),
        ...(entry.spec.tests ?? []),
      ];
    } else {
      byKey.set(key, {
        spec: { ...entry.spec, tests: [...(entry.spec.tests ?? [])] },
        titlePath: entry.titlePath,
      });
      order.push(key);
    }
  }

  return order.map(key => byKey.get(key)!);
}

// --- Status normalisation ---

/**
 * Map the final attempt's raw status to a FailedTest status. All five
 * reachable values are handled explicitly. A raw status of `undefined`
 * (declared `TestStatus | undefined` upstream) normalises to 'failed' rather
 * than being silently dropped or propagated as an invalid type.
 */
function normaliseStatus(
  result: ReportTestResult | undefined
): FailedTest['status'] {
  const status = result?.status;
  return status ?? 'failed';
}

function extractError(result: ReportTestResult | undefined): {
  error?: string;
  errorStack?: string;
} {
  if (!result) return {};
  const err = result.error ?? result.errors?.[0];
  if (!err) return {};
  const message = err.message ?? err.value;
  return {
    error: message ? message.split('\n')[0] : undefined,
    errorStack: err.stack ?? message,
  };
}

// --- Grouping across merged blob reports ---

/**
 * Group a spec's TestCase entries by project name.
 *
 * One (spec, project) pair can hold MORE than one TestCase entry, for two
 * unrelated reasons, and both must collapse to a single reported failure:
 *
 * 1. `playwright merge-reports` combining an initial run's blob with a
 *    targeted `--grep` rerun's blob - NF's own CI flow - appends the rerun's
 *    TestCase onto the same spec's `tests[]`.
 * 2. Playwright FAILING to do that, and emitting two separate spec entries
 *    instead. `mergeDuplicateSpecEntries` collapses those before we get here.
 *
 * Case 2 looks random and is not. The reporter's "same test" comparison is
 * `s.file === toPosixPath(path.relative(config.rootDir, spec.file))`
 * (json.js:149), but `spec.file` is ALREADY relative by then - serialisation
 * made it so via `_relativeLocation` (json.js:125). `path.relative` resolves
 * a relative second argument against `process.cwd()`, so the comparison holds
 * only when cwd equals `config.rootDir` - and rootDir is the resolved
 * `testDir`, not the config directory (config.js:79). Merge a set of blobs
 * from the testDir and you get one spec with two `tests[]`; merge the very
 * same blobs from anywhere else and you get two specs, whose `id`s differ by
 * a salt `merge-reports` appends on collision (merge.js:393). Both shapes are
 * generated on purpose by tests/global-setup.ts and must extract identically.
 *
 * Genuinely different projects (chromium vs webkit) stay in separate groups:
 * those are different environments, not repeated attempts at one execution.
 *
 * Known limitation, inherited from using Playwright's own key: `repeatEach`
 * clones and two configured projects sharing one `name` both land distinct
 * executions in a single group. Playwright's reporter collapses them the same
 * way; `includeFlaky: true` surfaces them.
 */
function groupByProject(
  tests: ReportTestCase[]
): Map<string, ReportTestCase[]> {
  const groups = new Map<string, ReportTestCase[]>();
  for (const test of tests) {
    const key = test.projectName ?? '';
    const group = groups.get(key);
    if (group) {
      group.push(test);
    } else {
      groups.set(key, [test]);
    }
  }
  return groups;
}

/** The most recent result across every TestCase in a group, by its own last
 *  result's `startTime` - NOT by array position. A merged report orders
 *  entries by blob, and the blobs are merged in filename order, neither of
 *  which is chronological. Falls back to the last TestCase in the group when
 *  no result carries a `startTime`. */
function mostRecentResult(group: ReportTestCase[]): {
  test: ReportTestCase;
  result: ReportTestResult | undefined;
} {
  let best:
    { test: ReportTestCase; result: ReportTestResult | undefined } | undefined;
  let bestTime = -Infinity;
  for (const test of group) {
    const results = test.results ?? [];
    const last = results[results.length - 1];
    const time = last?.startTime ? Date.parse(last.startTime) : NaN;
    if (!best || (Number.isFinite(time) && time > bestTime)) {
      best = { test, result: last };
      if (Number.isFinite(time)) bestTime = time;
    }
  }
  return best ?? { test: group[group.length - 1], result: undefined };
}

/** Net outcome of a (spec, project) group - see `groupOutcome`'s doc comment
 *  for what each value means and why 'flaky' needs grouping to reach at all. */
type GroupOutcome = 'unexpected' | 'flaky' | 'expected' | 'skipped';

/** Net outcome of a (spec, project) group, generalising Playwright's own
 *  single-TestCase `outcome()` across however many TestCase entries a merge
 *  put in the group:
 *  - 'unexpected': every entry unexpected - still failing, always reported.
 *  - 'flaky': a genuine mix - at least one unexpected AND at least one
 *    entry that was not (whether that's a single TestCase whose own
 *    results[] resolved to 'flaky', or two separate TestCase entries from a
 *    rerun-merge where one passed) - something eventually succeeded.
 *    Reported only when `includeFlaky` is set.
 *  - 'expected': no unexpected entry, and something actually ran and passed.
 *  - 'skipped': no unexpected entry and nothing passed either - every entry
 *    was skipped (e.g. a test interrupted on its only attempt, or dropped
 *    from the queue by a failure cap with an empty results[]).
 *
 *  The 'flaky' branch is the one Playwright itself cannot reach across a
 *  rerun merge. `computeTestCaseOutcome` only ever reads a SINGLE TestCase's
 *  own results[], and `merge-reports` builds its receiver with
 *  `mergeTestCases: false`, so an initial run and its rerun stay two separate
 *  single-result TestCase entries - one 'unexpected', one 'expected', neither
 *  'flaky'. Grouping them here is what recovers the real answer.
 *
 *  The split between 'expected' and 'skipped' carries no weight for
 *  `extractFailedTests` (neither is ever reported as a failure); it exists so
 *  `analyze` can tally them into distinct buckets. */
function groupOutcome(group: ReportTestCase[]): GroupOutcome {
  const hasUnexpected = group.some(t => t.status === 'unexpected');
  const hasOther = group.some(t => t.status !== 'unexpected');
  if (hasUnexpected && !hasOther) return 'unexpected';
  if (hasUnexpected && hasOther) return 'flaky';
  if (!hasUnexpected && group.some(t => t.status === 'flaky')) return 'flaky';
  return group.some(t => t.status === 'expected') ? 'expected' : 'skipped';
}

/** One (spec, project) execution, fully analyzed: its net outcome plus
 *  everything needed to build a `FailedTest` from it without re-walking the
 *  report. The single object both `extractFailedTests` and `analyze` are
 *  built from, so the failed list and the totals can never disagree. */
interface AnalyzedGroup {
  spec: ReportSpec;
  titlePath: string[];
  projectName: string;
  group: ReportTestCase[];
  outcome: GroupOutcome;
}

/**
 * Walk the whole report to one `AnalyzedGroup` per (spec, project) - the
 * shared core of `extractFailedTests` and `analyze`. Runs the walk exactly
 * once: `walkSpecs` the suite tree, `mergeDuplicateSpecEntries` to undo
 * Playwright's own failed merge (see its doc comment), `groupByProject` to
 * collapse a rerun-merge's extra TestCase entries, then `groupOutcome` per
 * group. The `projects` filter is applied here so a filtered project never
 * counts toward `analyze`'s totals either.
 */
function collectGroups(
  report: PlaywrightJSONReport,
  projects: string[]
): AnalyzedGroup[] {
  const allEntries: { spec: ReportSpec; titlePath: string[] }[] = [];
  for (const suite of report.suites ?? []) {
    allEntries.push(...walkSpecs(suite, []));
  }
  // Deduped GLOBALLY, not per top-level suite: an unmerged report can also
  // duplicate the whole file-level suite itself, not just the spec inside it.
  const dedupedEntries = mergeDuplicateSpecEntries(allEntries);

  const out: AnalyzedGroup[] = [];
  for (const { spec, titlePath } of dedupedEntries) {
    const groups = groupByProject(spec.tests ?? []);
    for (const [projectName, group] of groups) {
      if (
        projects.length > 0 &&
        projectName &&
        !projects.includes(projectName)
      ) {
        continue;
      }
      out.push({
        spec,
        titlePath,
        projectName,
        group,
        outcome: groupOutcome(group),
      });
    }
  }
  return out;
}

/** Build a `FailedTest` from one already-analyzed group. Shared by
 *  `extractFailedTests` and `analyze` so the record shape can't drift
 *  between the two entry points. */
function buildFailedTest(entry: AnalyzedGroup): FailedTest {
  const { spec, titlePath, projectName, group } = entry;
  const { result: last } = mostRecentResult(group);
  const totalAttempts = group.reduce(
    (sum, t) => sum + (t.results?.length ?? 0),
    0
  );
  const { error, errorStack } = extractError(last);
  const fullTitlePath = [...titlePath, spec.title];

  return {
    title: fullTitlePath.join(' > '),
    titlePath: fullTitlePath,
    file: spec.file,
    line: spec.line,
    column: spec.column,
    project: projectName || undefined,
    tags: spec.tags ?? [],
    error,
    errorStack,
    duration: last?.duration,
    retries: Math.max(totalAttempts - 1, 0),
    status: normaliseStatus(last),
  };
}

/** Whether an analyzed group should appear in a failed-tests list, given
 *  `includeFlaky`. The one predicate both `extractFailedTests` and `analyze`
 *  use, so "is this reported as failing" means the same thing in both. */
function isWantedFailure(
  outcome: GroupOutcome,
  includeFlaky: boolean
): boolean {
  return outcome === 'unexpected' || (includeFlaky && outcome === 'flaky');
}

// --- Extraction ---

/**
 * Parse a Playwright JSON report (from `--reporter=json` or
 * `playwright merge-reports --reporter=json`) and return every (spec,
 * project) whose every attempt was 'unexpected' - i.e. every failure that
 * NO rerun cleared, and that a further rerun would want to retry.
 *
 * Selection groups TestCase entries per (spec, project) rather than reading
 * `spec.ok`, for two reasons, both empirically confirmed:
 *
 * 1. Report merging appends TestCase entries onto a spec without
 *    recomputing `spec.ok`, so `ok` can go stale relative to a later
 *    project's or a later rerun's result.
 * 2. A group can contain MULTIPLE entries under the identical project (see
 *    `groupByProject`) - NF's own rerun-and-merge pattern produces exactly
 *    this. Reporting per-TestCase without grouping would flag a test that
 *    failed originally and passed on rerun as still failing, which is
 *    wrong: the rerun's job is to clear it.
 *
 * Before grouping, `mergeDuplicateSpecEntries` first collapses any specs
 * Playwright's OWN merge tool left as duplicates instead of combining, which
 * it does whenever the report was generated from a working directory other
 * than the config's rootDir (see `groupByProject`).
 *
 * A group counts as a failure only when EVERY entry in it is 'unexpected'.
 * A mixed group (any passing/flaky/skipped attempt, from any project-tagged
 * blob) means something ultimately succeeded, so the group is excluded.
 *
 * @example
 * ```ts
 * import { extractFailedTests } from 'playwright-report-analyzer';
 *
 * const failed = extractFailedTests('results.json');
 * console.log(`${failed.length} still-failing test(s)`);
 * ```
 */
export function extractFailedTests(
  source: string | PlaywrightJSONReport,
  options?: ExtractOptions
): FailedTest[] {
  const opts = { ...defaultOptions, ...options };
  const report = loadReport(source);
  const groups = collectGroups(report, opts.projects);

  const out: FailedTest[] = [];
  for (const entry of groups) {
    if (!isWantedFailure(entry.outcome, opts.includeFlaky)) continue;
    out.push(buildFailedTest(entry));
  }
  return out;
}

/**
 * Parse a Playwright JSON report and return both a trustworthy summary and
 * the failed-tests list, from a single walk - the entry point for a
 * pass/fail CI notification (Slack, a check run, ...) that needs totals
 * alongside which tests to rerun.
 *
 * `summary.total/passed/failed/flaky/skipped` is a strict partition of every
 * (spec, project) execution in the report: `passed + failed + flaky +
 * skipped === total`, always, regardless of `includeFlaky` - that option only
 * changes which groups land in the returned `failed[]`, never how they are
 * tallied. Reconcile with:
 *
 * - `includeFlaky: false` (default) - `failed.length === summary.failed`
 * - `includeFlaky: true` - `failed.length === summary.failed + summary.flaky`
 *
 * This does NOT read `report.stats`, on purpose: see `extractRawStats` for
 * why Playwright's own counts double-count a rerun-merge and can never mark
 * a rerun-cleared test 'flaky'. `summary.duration` and `summary.startTime`
 * are the exception - those are timings, not counts, so they are read
 * straight from `report.stats`.
 *
 * `summary.ok` is `failed === 0 && reportErrors === 0`: a spec file that
 * fails to import produces zero failed groups and a non-zero Playwright exit
 * code, so `failed === 0` alone is not "the build is green".
 *
 * @example
 * ```ts
 * import { analyze } from 'playwright-report-analyzer';
 *
 * const { summary, failed } = analyze('merged-report.json');
 * if (summary.ok) {
 *   postSlack(`✅ ${summary.total} passed`);
 * } else {
 *   postSlack(`❌ ${summary.failed} failing of ${summary.total}`, failed);
 * }
 * ```
 */
export function analyze(
  source: string | PlaywrightJSONReport,
  options?: ExtractOptions
): AnalyzeResult {
  const opts = { ...defaultOptions, ...options };
  const report = loadReport(source);
  const groups = collectGroups(report, opts.projects);

  let passed = 0;
  let failed = 0;
  let flaky = 0;
  let skipped = 0;
  const failedTests: FailedTest[] = [];

  for (const entry of groups) {
    switch (entry.outcome) {
      case 'unexpected':
        failed++;
        break;
      case 'flaky':
        flaky++;
        break;
      case 'expected':
        passed++;
        break;
      case 'skipped':
        skipped++;
        break;
    }

    if (isWantedFailure(entry.outcome, opts.includeFlaky)) {
      failedTests.push(buildFailedTest(entry));
    }
  }

  const stats: Partial<ReportStats> = report.stats ?? {};
  const reportErrors = (report.errors ?? []).length;

  return {
    summary: {
      total: groups.length,
      passed,
      failed,
      flaky,
      skipped,
      duration: stats.duration ?? 0,
      startTime: stats.startTime ?? '',
      reportErrors,
      ok: failed === 0 && reportErrors === 0,
    },
    failed: failedTests,
  };
}

/**
 * Computed, trustworthy total/passed/failed/flaky/skipped counts - a thin
 * wrapper over `analyze(source, options).summary`. Prefer `analyze` directly
 * when the failed-tests list is needed too; this exists for a caller that
 * only wants the tally.
 */
export function extractSummary(
  source: string | PlaywrightJSONReport,
  options?: ExtractOptions
): TestSummary {
  return analyze(source, options).summary;
}

/**
 * Read the report's own `stats` block, verbatim - Playwright's raw
 * expected/unexpected/flaky/skipped counts, plus timing. Kept for a caller
 * that specifically wants Playwright's own figures; prefer `analyze` or
 * `extractSummary` for anything that will be reported as-is, including in
 * CI notifications.
 *
 * This is unsafe as a correctness check on a merged report, for two
 * confirmed reasons:
 *
 * 1. **Double-counting.** `stats.unexpected` counts every unexpected
 *    TestCase entry individually, with no grouping. `merge-reports` builds
 *    its receiver with `mergeTestCases: false` (runner/index.js:7991), so an
 *    initial run's TestCase and its `--grep` rerun's TestCase stay two
 *    separate entries. A test that failed then was cleared by the rerun
 *    tallies as BOTH `unexpected++` (the initial run) AND `expected++` (the
 *    rerun) - one test, counted in two buckets, and there is no `total`
 *    field to sanity-check it against (the JSON reporter never emits one;
 *    only the HTML reporter does).
 * 2. **Flaky is unreachable across a rerun merge.** Playwright's own
 *    `computeTestCaseOutcome` (runner/index.js:605) reads a SINGLE
 *    TestCase's own `results[]` to decide 'flaky' - it needs both an
 *    expected and an unexpected result in the same array. Two separate
 *    single-result TestCase entries can never satisfy that, so
 *    `stats.flaky` stays 0 even when a rerun visibly cleared a failure.
 *
 * `extractFailedTests` counts (spec, project) GROUPS instead, and a
 * rerun-merge report can hold more than one TestCase entry per group (see
 * `groupByProject`). So `extractFailedTests(source).length` only equals
 * `extractRawStats(source).unexpected` when no (spec, project) pair has more
 * than one TestCase entry - true for a plain single-run report, never
 * guaranteed once `merge-reports` has combined a rerun.
 */
export function extractRawStats(
  source: string | PlaywrightJSONReport
): RawStats {
  const report = loadReport(source);
  const stats: Partial<ReportStats> = report.stats ?? {};
  return {
    expected: stats.expected ?? 0,
    unexpected: stats.unexpected ?? 0,
    flaky: stats.flaky ?? 0,
    skipped: stats.skipped ?? 0,
    duration: stats.duration ?? 0,
    startTime: stats.startTime ?? '',
  };
}

/**
 * Read the report's top-level `errors[]` - config/compile errors, such as a
 * spec file that failed to import. These produce zero failed specs and a
 * non-zero Playwright exit code, so a caller that only checks
 * `extractFailedTests` can wrongly conclude a catastrophically broken build
 * had no failures.
 */
export function extractReportErrors(
  source: string | PlaywrightJSONReport
): ReportErrorSummary[] {
  const report = loadReport(source);
  return (report.errors ?? []).map(e => ({
    message: e.message ?? e.value,
    stack: e.stack,
  }));
}
