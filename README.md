# Playwright Report Analyzer

<div align="center">

[![npm version](https://img.shields.io/npm/v/playwright-report-analyzer.svg)](https://www.npmjs.com/package/playwright-report-analyzer)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![CI](https://github.com/hoangtaiki/playwright-report-analyzer/actions/workflows/ci.yml/badge.svg)](https://github.com/hoangtaiki/playwright-report-analyzer/actions/workflows/ci.yml)
[![Coverage](https://codecov.io/gh/hoangtaiki/playwright-report-analyzer/branch/main/graph/badge.svg)](https://codecov.io/gh/hoangtaiki/playwright-report-analyzer)
[![Downloads](https://img.shields.io/npm/dt/playwright-report-analyzer.svg)](https://www.npmjs.com/package/playwright-report-analyzer)

**Trustworthy totals and still-failing tests out of a Playwright JSON report**

</div>

Reads a Playwright JSON report, including one that `merge-reports` has already
combined from an initial run and a `--grep` rerun, and gives you two things
that agree with each other: a total/passed/failed/flaky/skipped summary for a
CI notification, and the list of tests that are **still failing**, turned into
a `--grep` pattern so your CI can rerun exactly those.

Zero runtime dependencies. Playwright itself is not required at runtime, because
this reads the report, not your test suite.

## The Problem

The usual way to pull failures out of a report is a `jq` one-liner:

```sh
jq -r '.suites[].suites[].specs[] | select(.ok == false) | .title' results.json
```

Run that against a real report and you get:

```
jq: error (at results.json:755): Cannot iterate over null (null)
```

Exit code 5, **mid-stream**, with whatever it printed so far. If the script only
captures stdout, the rerun step sees an empty list and reruns nothing, while the
build still goes green.

Three separate things are wrong with that selector:

| Problem                                         | What happens                                                                                                                                                                                        |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.suites[].suites[]` assumes exactly two levels | Playwright omits the `suites` key entirely for a spec file with no `describe`, so `jq` iterates null and aborts. Describe-less file first gives an empty list; later gives a silently truncated one |
| `spec.ok` goes stale                            | Merging appends test entries to a spec without recomputing `ok`, so a test that failed and then **passed on a rerun** still reads `ok: false`                                                       |
| No notion of a rerun                            | After `merge-reports` combines an initial run with a `--grep` rerun, every test that ever failed is reported, including the ones the rerun cleared                                                  |

## The Solution

```ts
import { extractFailedTests, toGrepPattern } from 'playwright-report-analyzer';

const failed = extractFailedTests('results.json');
const pattern = toGrepPattern(failed, { idPattern: /[A-Z][A-Z0-9]*-\d+/ });
// "CBRO-02|CAM2-03"
```

Selection is on the **net outcome per (test, project)**, walking the suite tree
to any depth. A test is reported only when _every_ attempt recorded for it
anywhere in the report was unexpected. Passed on a rerun, or on a retry, means
it is not still failing, so it is not in the list.

## Why not `report.stats`?

Playwright's own JSON report carries a `stats` block with `expected` /
`unexpected` / `flaky` / `skipped` counts, and it looks like the obvious
source for a "120 ran, 2 failed" CI message. It isn't safe to use once
`merge-reports` has combined an initial run with a `--grep` rerun, which is
NF's own CI flow, and probably yours too.

`merge-reports` builds its receiver with `mergeTestCases: false` (confirmed
against the installed `playwright` package's runner), so a rerun's `TestCase`
never lands in the initial run's own `results[]`. It becomes a second,
independent `TestCase` instead, and that has two consequences, both
reproducible against a real `merge-reports` output:

- **Double-counting.** A test that failed on the initial run and passed on the
  rerun tallies as `unexpected++` from the first TestCase and `expected++`
  from the second. One test ends up counted in two buckets, and there's no
  `total` field to catch the discrepancy against (the JSON reporter never
  emits one).
- **`flaky` becomes unreachable.** Playwright decides `flaky` by checking
  whether a single `TestCase`'s own `results[]` contains both an expected and
  an unexpected result. Two separate single-result TestCases can never
  satisfy that, so `stats.flaky` stays `0` even when a rerun visibly cleared a
  failure.

Here's what that looks like concretely. Two tests behind a rerun merge, one
that failed then passed on rerun and one that failed on both runs, produce:

```ts
extractRawStats(report);
// { expected: 1, unexpected: 3, flaky: 0, skipped: 0 }   <- sums to 4

analyze(report).summary;
// { total: 2, passed: 0, failed: 1, flaky: 1, skipped: 0, ok: false }
```

Two tests ran. `report.stats` disagrees on all four numbers. `analyze` groups
every `TestCase` by `(spec, project)` first, the same grouping
`extractFailedTests` already needed to avoid re-reporting a rerun-cleared test,
so the totals and the failed list can never contradict each other.

## Quick Start

### Requirements

- Node.js 20.0.0 or higher
- ESM only

```sh
npm install --save-dev playwright-report-analyzer
```

### In a CI rerun-and-notify flow

```sh
# 1. Run the suite, keeping the JSON report
npx playwright test --reporter=json > results.json || true

# 2. Ask for the still-failing tests as a grep pattern
npx playwright-report-analyzer results.json \
  --grep --id-pattern '[A-Z][A-Z0-9]*-\d+' --out failed_tests.txt

# 3. Rerun only those, merge the two blob reports, then get totals + failures
# for Slack in one call
[ -s failed_tests.txt ] && npx playwright test --grep "$(cat failed_tests.txt)"
npx playwright merge-reports ./blob-report --reporter=json > merged.json
npx playwright-report-analyzer merged.json --full --pretty
```

The CLI exits **0 even when tests failed**. It reports, it does not gate, so
it will not fail your build on your behalf. Check `--summary`'s `ok` field (or
`analyze(...).summary.ok` in code) for whether to post a red or green message.

## CLI

```
playwright-report-analyzer <report.json> [options]
```

| Flag                   | Meaning                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------ |
| `--grep`               | Print a `--grep` pattern instead of JSON                                             |
| `--summary`            | Print the computed `TestSummary` instead of the failed-tests array                   |
| `--full`               | Print `{ summary, failed }` instead of just the failed-tests array                   |
| `--id-pattern <regex>` | Extract a short id from each test's own title (bare pattern, no delimiters or flags) |
| `--separator <sep>`    | Separator between grep alternatives (default `\|`)                                   |
| `--include-flaky`      | Include flaky (failed, then passed) tests                                            |
| `--out <file>`         | Write to a file instead of stdout                                                    |
| `--pretty`             | Pretty-print JSON output (ignored with `--grep`)                                     |

`--grep` takes precedence over `--summary`/`--full` when combined.

| Exit code | Meaning                                       |
| --------- | --------------------------------------------- |
| `0`       | Ran normally, **including when tests failed** |
| `1`       | Report missing or malformed                   |
| `2`       | Bad arguments                                 |

A non-empty top-level `errors[]` in the report is printed to stderr and does
**not** change the exit code. Check `--summary`'s `reportErrors`/`ok` fields
instead if that distinction matters to your notification step.

## API

### `analyze(source, options?): { summary: TestSummary; failed: FailedTest[] }`

The primary entry point for a pass/fail CI notification: one parse, one walk,
a summary and the failed list that are guaranteed to agree.

```ts
interface TestSummary {
  total: number; // distinct (spec, project) executions
  passed: number;
  failed: number; // net still-failing groups
  flaky: number;
  skipped: number;
  duration: number; // from the report's own stats - sum across blobs if merged
  startTime: string;
  reportErrors: number; // top-level errors[].length
  ok: boolean; // failed === 0 && reportErrors === 0
}
```

`total`/`passed`/`failed`/`flaky`/`skipped` are a strict partition:
`passed + failed + flaky + skipped === total`, always, no matter what
`includeFlaky` is set to. That option only changes which groups land in
`failed`:

- `includeFlaky: false` (default): `failed.length === summary.failed`
- `includeFlaky: true`: `failed.length === summary.failed + summary.flaky`

```ts
import { analyze } from 'playwright-report-analyzer';

const { summary, failed } = analyze('merged-report.json');
if (summary.ok) {
  postSlack(`✅ ${summary.total} passed`);
} else {
  postSlack(`❌ ${summary.failed} failing of ${summary.total}`, failed);
}
```

Takes the same `options` as `extractFailedTests` below (`includeFlaky`,
`projects`); the totals honour a `projects` filter too.

### `extractFailedTests(source, options?): FailedTest[]`

`source` is a path to a JSON report, or an already-parsed report object.

```ts
interface FailedTest {
  title: string; // full path joined by ' > '
  titlePath: string[]; // the same path unjoined; the test's own title is last
  file?: string;
  line?: number;
  column?: number;
  project?: string;
  tags: string[]; // without the leading '@'
  error?: string; // first line of the error message
  errorStack?: string; // full message including stack
  duration?: number; // of the most recent attempt, in ms
  retries: number; // total attempts across the whole report, minus 1
  status: 'failed' | 'timedOut' | 'interrupted' | 'passed' | 'skipped';
}
```

| Option         | Default | Meaning                                       |
| -------------- | ------- | --------------------------------------------- |
| `includeFlaky` | `false` | Include tests that failed and then passed     |
| `projects`     | all     | Only report failures from these project names |

Three behaviours worth knowing before you rely on it:

- **`status: 'passed'` is a failure.** A `test.fail()`-annotated test that
  unexpectedly passed is reported, because the outcome was unexpected.
- **`retries` counts attempts across the whole report.** A test that ran once in
  the initial run and once in a merged rerun reports `retries: 1`, exactly like
  a test retried in-process. The two are indistinguishable to a rerun step, so
  they are reported the same way.
- **One entry per failing (test, project).** A test failing on two projects
  appears twice, with different `project` values. `toGrepPattern` dedupes.

### `toGrepPattern(failed, options?): string`

Builds a single regex alternation for `playwright test --grep`.

| Option        | Default   | Meaning                                                                        |
| ------------- | --------- | ------------------------------------------------------------------------------ |
| `idPattern`   | -         | Extract a short id from each test's own title. Omit to use escaped full titles |
| `separator`   | `\|`      | Joiner between alternatives                                                    |
| `unique`      | `true`    | Drop duplicate ids                                                             |
| `onUnmatched` | `'title'` | When `idPattern` matches nothing: `'title'`, `'skip'` or `'throw'`             |

`idPattern` is applied to the test's own title, never the joined path, so it
cannot accidentally match part of a file path or a describe title.

`onUnmatched: 'title'` is the safe default against _dropping_ a test, but an
escaped full title is long and widens the alternation. Use `'throw'` if your
suite guarantees every test carries an id.

### `extractSummary(source, options?): TestSummary`

A thin wrapper over `analyze(source, options).summary`, for a caller that only
wants the tally and not the failed-tests list.

### `extractRawStats(source): RawStats`

Playwright's own `stats` block, verbatim: `expected`, `unexpected`, `flaky`,
`skipped`, `duration`, `startTime`. Kept for a caller that specifically wants
Playwright's own figures.

**Don't use this for a CI notification once a rerun has been merged in.** See
"Why not `report.stats`?" above: `stats.unexpected` counts every unexpected
`TestCase` individually with no grouping, so a rerun-cleared test is counted
as both a failure and a pass, and `stats.flaky` structurally cannot register a
test a rerun cleared. It agrees with `analyze`'s totals on a plain, unmerged
report. Any disagreement on a merged one is expected, not a bug.

### `extractReportErrors(source): ReportErrorSummary[]`

The report's top-level `errors[]`: config and compile failures, such as a spec
file that fails to import.

**Check this one.** Such a run produces _zero_ failed specs, so code that only
looks at `extractFailedTests` concludes a catastrophically broken build had no
failures and reruns nothing.

```ts
const errors = extractReportErrors('results.json');
if (errors.length) {
  console.error('Build is broken, not merely failing:', errors[0].message);
}
```

## How it is tested

This package's own test suite contains **no stored JSON reports**. Every report
it asserts against is produced on each run by really invoking Playwright,
including the real `blob` reporter and the real `merge-reports` CLI, across nine
scenarios: describe-less files, four-level nesting, timeouts, flaky retries,
abandoned retries, interrupted attempts, multi-project merges and rerun merges.

A committed snapshot would stop testing the installed Playwright and start
testing a frozen copy of what it used to emit, so a schema change in an upgrade
would pass silently. Here it fails the build.

See [report-src/README.md](report-src/README.md), which also documents an
upstream `merge-reports` bug this library has to work around.

## License

MIT (c) Harry Tran
