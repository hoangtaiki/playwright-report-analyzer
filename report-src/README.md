# report-src

The inputs used to test this package. **Nothing in here is a stored JSON
report.** These are real Playwright specs and configs; `tests/global-setup.ts`
runs them with the real runner, the real `blob` reporter and the real
`merge-reports` CLI on every `npm test`, writing the resulting reports to
`.tmp-reports/` (gitignored).

That is slower than committing snapshots, deliberately. A snapshot stops
testing the installed Playwright and starts testing a copy of what Playwright
used to emit, so a schema change in a Playwright upgrade would pass silently.
Here it fails the build.

This directory sits outside `testDir`, so these intentionally-failing specs are
never collected by the package's own suite.

## Scenarios

| Report                                        | Config                                                                                      | What it covers                                                                                                                                                                                                                                                           |
| --------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `structural`                                  | `playwright.structural.config.ts`                                                           | A describe-less spec file sorted both first and last among its siblings, a test nested four levels deep, and the ordinary result statuses: `failed`, `timedOut`, `passed` (a `test.fail()` test that unexpectedly passed) and a flaky test under a `retries: 1` project. |
| `report-errors`                               | `playwright.report-error.config.ts`                                                         | A spec file that fails to import, producing top-level `errors[]` with zero failed specs.                                                                                                                                                                                 |
| `empty`                                       | `playwright.structural.config.ts` with `--grep` matching nothing and `--pass-with-no-tests` | A run with no tests. Without `--pass-with-no-tests` this is a hard error and the report carries a spurious `No tests found`.                                                                                                                                             |
| `merge-multiproject`                          | `playwright.merge-multiproject.config.ts`                                                   | Two projects, two blobs, one real merge. A test that passes on one project and fails on the other, and a test that fails on both.                                                                                                                                        |
| `merge-rerun-unmerged` / `merge-rerun-merged` | `playwright.merge-rerun.config.ts`                                                          | NF's own flow: a full run, then an `IS_RERUN` `--grep` rerun of what failed, merged back together. One set of blobs, merged twice, from two working directories. See below.                                                                                              |
| `abandoned-retry`                             | `playwright.abandoned-retry.config.ts`                                                      | A serial suite under `retries: 1` whose first test fails on the retry, so the second never runs: a real `results[]` entry with `status: 'skipped'` at `retry: 1`.                                                                                                        |
| `max-failures`                                | `playwright.max-failures.config.ts`                                                         | A failure cap tripped on the first test, so the queued tests are dropped with **no result at all**: a real empty `results[]`.                                                                                                                                            |
| `interrupted`                                 | `playwright.interrupted.config.ts`                                                          | Real `interrupted` results, in both the shape that must be reported (`[failed, interrupted]`) and the shape that must not (`[interrupted]`).                                                                                                                             |

## Why `merge-rerun` is generated twice

`merge-rerun-unmerged` and `merge-rerun-merged` come from **the same two
blobs**. They differ only in the working directory `merge-reports` ran from,
and that changes the report Playwright produces.

The JSON reporter decides two spec entries are the same test with

```js
s.file === toPosixPath(path.relative(this.config.rootDir, spec.file)); // json.js:149
```

but `spec.file` is already relative at that point, made so by
`_relativeLocation` during serialisation (`json.js:125`). `path.relative`
resolves a relative second argument against `process.cwd()`, so the comparison
only holds when cwd happens to equal `config.rootDir` - and `rootDir` is the
resolved `testDir`, not the config directory (`config.js:79`).

- Merged from `report-src/specs` (the testDir): one spec, two `tests[]` entries.
- Merged from anywhere else: two separate spec entries, whose `id`s differ by a
  salt `merge-reports` appends on collision (`merge.js:393`).

Both are valid reports of the same run, and `extractFailedTests` must return
identical results from either. `tests/extract.spec.ts` asserts exactly that.

This is an upstream Playwright bug, not a documented option. It is reproduced
here on purpose because NF's CI hits it: the rerun flow merges blobs, and
whether the pipeline happens to `cd` into the testDir first decides the shape.

## Known limitations of the identity key

`mergeDuplicateSpecEntries` uses Playwright's own key for "same test",
`title + file + line + column`. Two same-project executions can legitimately
share all four and are therefore collapsed into one group:

- `repeatEach > 1`. The clones are made after the duplicate-title check and
  only the test id differs.
- Two configured projects sharing one `name`. Only the project _id_ is
  uniquified.

Playwright's own reporter collapses both the same way. `includeFlaky: true`
surfaces them.

## Not covered, and why

A result with **no `status` field** is unreachable from a real run: the JSON
reporter always writes it (`json.js:194`), and both result constructors default
it to `'skipped'` (`test.js:297`, `teleReceiver.js:419`). The `?? 'failed'`
fallback in `normaliseStatus` remains as defence against the declared
`TestStatus | undefined` type, but no test asserts it, because producing it
would require hand-authoring a report that Playwright cannot emit. The real,
reachable shape is an empty `results[]`, which `max-failures` covers.

## Running one scenario by hand

```sh
cd report-src
PLAYWRIGHT_JSON_OUTPUT_FILE=$PWD/../.tmp-reports/structural.json \
  npx playwright test --config=playwright.structural.config.ts
```

`PLAYWRIGHT_JSON_OUTPUT_FILE` and `PLAYWRIGHT_BLOB_OUTPUT_DIR` must be absolute:
they resolve against `process.cwd()`, and the cwd varies between scenarios.
