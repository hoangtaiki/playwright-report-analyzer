#!/usr/bin/env node
import { realpathSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { analyze, extractReportErrors } from './extract.js';
import { toGrepPattern } from './grep.js';

function printUsage(): void {
  console.error(`Usage: playwright-report-analyzer <report.json> [options]

Options:
  --grep                 Print a --grep pattern instead of JSON
  --summary              Print the computed total/passed/failed/flaky/skipped summary instead of the failed-tests array
  --full                 Print { summary, failed } instead of just the failed-tests array
  --id-pattern <regex>   Regex (no delimiters/flags) extracting a short id from each title
  --separator <sep>      Separator between grep alternatives (default: |)
  --include-flaky        Include flaky (failed-then-passed) tests
  --out <file>           Write output to a file instead of stdout
  --pretty               Pretty-print JSON output (ignored with --grep)

Exit codes: 0 = ran normally (even if tests failed); 1 = missing/malformed
report; 2 = bad arguments. A non-empty top-level errors[] in the report is
printed to stderr and does NOT affect the exit code (check --summary's
reportErrors/ok fields instead of the exit code for a catastrophic build).`);
}

/** @internal exported for testing */
export function run(argv: string[]): number {
  const args = [...argv];
  const reportPath = args.find(a => !a.startsWith('--'));
  if (!reportPath) {
    printUsage();
    return 2;
  }

  let grep = false;
  let summary = false;
  let full = false;
  let idPatternRaw: string | undefined;
  let separator: string | undefined;
  let includeFlaky = false;
  let outFile: string | undefined;
  let pretty = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--grep':
        grep = true;
        break;
      case '--summary':
        summary = true;
        break;
      case '--full':
        full = true;
        break;
      case '--id-pattern':
        idPatternRaw = args[++i];
        break;
      case '--separator':
        separator = args[++i];
        break;
      case '--include-flaky':
        includeFlaky = true;
        break;
      case '--out':
        outFile = args[++i];
        break;
      case '--pretty':
        pretty = true;
        break;
      default:
        break;
    }
  }

  let idPattern: RegExp | undefined;
  if (idPatternRaw !== undefined) {
    try {
      idPattern = new RegExp(idPatternRaw);
    } catch (err) {
      console.error(
        `playwright-report-analyzer: invalid --id-pattern: ${(err as Error).message}`
      );
      return 2;
    }
  }

  let result;
  try {
    result = analyze(reportPath, { includeFlaky });
  } catch (err) {
    console.error((err as Error).message);
    return 1;
  }
  const { summary: computedSummary, failed } = result;

  const reportErrors = extractReportErrors(reportPath);
  if (reportErrors.length > 0) {
    console.error(
      `playwright-report-analyzer: report contains ${reportErrors.length} top-level error(s):`
    );
    for (const e of reportErrors)
      console.error(`  - ${e.message ?? '(no message)'}`);
  }

  const output = grep
    ? toGrepPattern(failed, { idPattern, separator })
    : JSON.stringify(
        summary ? computedSummary : full ? result : failed,
        null,
        pretty ? 2 : undefined
      );

  if (outFile) {
    writeFileSync(outFile, `${output}\n`);
  } else {
    console.log(output);
  }

  return 0;
}

/**
 * Whether this module is the process entrypoint.
 *
 * Comparing `import.meta.url` to `file://${process.argv[1]}` is NOT enough.
 * npm installs a `bin` as a symlink in `node_modules/.bin`, so `argv[1]` is
 * the symlink while `import.meta.url` is the resolved real path - they never
 * match, and the CLI exits 0 having done nothing, which is precisely the
 * silent-empty-output failure this package exists to prevent. The naive form
 * also mangles paths containing spaces or other characters that need URL
 * encoding.
 *
 * @internal exported for testing
 */
export function isEntrypoint(
  argv1: string | undefined,
  moduleUrl: string
): boolean {
  if (!argv1) return false;
  try {
    return pathToFileURL(realpathSync(argv1)).href === moduleUrl;
  } catch {
    // argv[1] is not a resolvable path (a REPL, an eval, a deleted file).
    return false;
  }
}

/* c8 ignore start */
if (isEntrypoint(process.argv[1], import.meta.url)) {
  process.exit(run(process.argv.slice(2)));
}
/* c8 ignore stop */
