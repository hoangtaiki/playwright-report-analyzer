import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import * as path from 'node:path';
import {
  REPORTS,
  REPORT_SRC_DIR,
  REPORTS_DIR,
  reportPath,
  scratchPath,
  type ReportName,
} from './support/reports.js';

/**
 * Produce every report the suite asserts against by REALLY running Playwright:
 * the actual test runner, the actual blob reporter, and the actual
 * `merge-reports` CLI. Nothing here is hand-authored and nothing is committed;
 * `.tmp-reports/` is wiped and rebuilt on every run.
 *
 * This is slow by design. The alternative - storing snapshots - means the
 * suite stops testing the installed Playwright and starts testing a copy of
 * what Playwright used to emit.
 */

const BLOBS_DIR = path.join(REPORTS_DIR, 'blobs');

/**
 * Absolute path to Playwright's own CLI entrypoint.
 *
 * Resolved and run through `process.execPath` rather than shelling out to
 * `npx`: on Windows `npx` is `npx.cmd`, which `execFileSync` cannot launch
 * without a shell, so every scenario silently produced no report at all. Going
 * straight to the CLI is also faster and immune to PATH differences.
 *
 * `cli.js` is not in either package's `exports` map, so it cannot be resolved
 * directly; `package.json` is, and carries the path in `bin`.
 */
const PLAYWRIGHT_CLI = (() => {
  const require = createRequire(import.meta.url);
  for (const pkg of ['playwright', '@playwright/test']) {
    try {
      const manifestPath = require.resolve(`${pkg}/package.json`);
      const manifest = require(`${pkg}/package.json`) as {
        bin?: Record<string, string>;
      };
      const bin = manifest.bin?.playwright;
      if (bin) return path.join(path.dirname(manifestPath), bin);
    } catch {
      // Try the next package.
    }
  }
  throw new Error(
    'global setup: could not locate the Playwright CLI. Is @playwright/test installed?'
  );
})();

/** Combined stdout+stderr of the last command run for each report, so a
 *  failure can say WHY rather than just that a file is missing. */
const lastOutput = new Map<ReportName, string>();

/** Run a Playwright CLI command. Every scenario here fails on purpose, so a
 *  non-zero exit is expected and ignored; the real check is that the report
 *  was written and parses (see `verify`). */
function playwright(
  args: string[],
  options: { cwd: string; env?: Record<string, string>; report?: ReportName }
): void {
  const env: NodeJS.ProcessEnv = { ...process.env, ...options.env };
  // c8 instruments this process; child runs must not inherit that, or every
  // scenario writes coverage fragments for code under test it never loaded.
  delete env.NODE_V8_COVERAGE;

  const record = (stdout: unknown, stderr: unknown) => {
    if (!options.report) return;
    const text = [String(stdout ?? ''), String(stderr ?? '')]
      .filter(Boolean)
      .join('\n');
    lastOutput.set(options.report, text.slice(-4000));
  };

  try {
    const stdout = execFileSync(process.execPath, [PLAYWRIGHT_CLI, ...args], {
      cwd: options.cwd,
      env,
      stdio: 'pipe',
      encoding: 'utf-8',
    });
    record(stdout, '');
  } catch (err) {
    // Expected: the specs under report-src/ are meant to fail. Keep the output
    // anyway - if the report is missing, this is the only clue to why.
    const e = err as { stdout?: unknown; stderr?: unknown; message?: string };
    record(e.stdout, e.stderr ?? e.message);
  }
}

/** Run one config straight to a JSON report. `PLAYWRIGHT_JSON_OUTPUT_FILE`
 *  wins over a config's `outputFile`, and must be absolute because the cwd
 *  varies between scenarios. */
function runToJson(
  config: string,
  out: ReportName,
  extraArgs: string[] = [],
  env: Record<string, string> = {}
): void {
  playwright(
    ['test', `--config=playwright.${config}.config.ts`, ...extraArgs],
    {
      cwd: REPORT_SRC_DIR,
      env: { PLAYWRIGHT_JSON_OUTPUT_FILE: reportPath(out), ...env },
    }
  );
}

/** Run one config to its own blob directory, for a later real merge. */
function runToBlob(
  config: string,
  blobDir: string,
  extraArgs: string[] = [],
  env: Record<string, string> = {}
): void {
  playwright(
    ['test', `--config=playwright.${config}.config.ts`, ...extraArgs],
    {
      cwd: REPORT_SRC_DIR,
      env: { PLAYWRIGHT_BLOB_OUTPUT_DIR: blobDir, ...env },
    }
  );
}

/**
 * Merge blobs with the real `merge-reports` CLI.
 *
 * `cwd` is load-bearing, not incidental. The JSON reporter decides two spec
 * entries are the same test with
 * `s.file === path.relative(config.rootDir, spec.file)` (json.js:149), but
 * `spec.file` is ALREADY relative by then, so `path.relative` resolves it
 * against `process.cwd()`. The merge therefore succeeds only when cwd equals
 * the config's rootDir - which is the resolved `testDir`, not the config
 * directory. Running the same blobs from two cwds yields two different, both
 * valid, report shapes, and the extractor has to handle both.
 */
function merge(blobDir: string, out: ReportName, cwd: string): void {
  playwright(['merge-reports', '--reporter=json', blobDir], {
    cwd,
    env: { PLAYWRIGHT_JSON_OUTPUT_FILE: reportPath(out) },
    report: out,
  });
}

/**
 * Copy one run's blob archives into the shared merge directory, under a
 * prefix. `merge-reports` reads its input directory FLAT and sorted
 * (`sortedShardFiles`), so blobs cannot be nested in per-run subdirectories,
 * and two runs both emitting `report.zip` would otherwise overwrite each
 * other. The numeric prefix also fixes the merge order, keeping the initial
 * run ahead of the rerun.
 */
function collectBlobs(fromDir: string, intoDir: string, prefix: string): void {
  if (!existsSync(fromDir)) return;
  for (const file of readdirSync(fromDir)) {
    if (!file.endsWith('.zip')) continue;
    copyFileSync(
      path.join(fromDir, file),
      path.join(intoDir, `${prefix}-${file}`)
    );
  }
}

function verify(name: ReportName): void {
  const file = reportPath(name);
  if (!existsSync(file)) {
    const output = lastOutput.get(name);
    throw new Error(
      [
        `global setup: Playwright produced no report at ${file}.`,
        `CLI: ${PLAYWRIGHT_CLI}`,
        output
          ? `Output from the run:\n${output}`
          : 'The run produced no output at all.',
      ].join('\n')
    );
  }
  try {
    JSON.parse(readFileSync(file, 'utf-8'));
  } catch (err) {
    throw new Error(
      `global setup: the report at ${file} is not valid JSON: ${(err as Error).message}`
    );
  }
}

export default function globalSetup(): void {
  if (
    process.env.SKIP_REPORT_GEN &&
    existsSync(reportPath(REPORTS.structural))
  ) {
    return;
  }

  rmSync(REPORTS_DIR, { recursive: true, force: true });
  mkdirSync(BLOBS_DIR, { recursive: true });

  // --- Single-run scenarios ---
  runToJson('structural', REPORTS.structural);
  runToJson('report-error', REPORTS.reportErrors);
  runToJson('structural', REPORTS.empty, [
    '--grep',
    'ZZZZ-NO-SUCH-TEST-ZZZZ',
    '--pass-with-no-tests',
  ]);
  runToJson('abandoned-retry', REPORTS.abandonedRetry);
  runToJson('max-failures', REPORTS.maxFailures);
  runToJson('interrupted', REPORTS.interrupted);

  // --- Multi-project merge: two projects, two blobs, one real merge ---
  {
    const combined = path.join(BLOBS_DIR, 'multiproject');
    mkdirSync(combined, { recursive: true });
    const projects = ['project-a', 'project-b'];
    projects.forEach((project, index) => {
      const blobDir = path.join(BLOBS_DIR, `mp-${project}`);
      runToBlob('merge-multiproject', blobDir, [`--project=${project}`]);
      collectBlobs(blobDir, combined, String(index + 1).padStart(2, '0'));
    });
    merge(combined, REPORTS.mergeMultiproject, REPORT_SRC_DIR);
  }

  // --- Rerun merge: NF's own initial-run + --grep-rerun flow ---
  // One set of blobs, merged TWICE from different cwds, to get both the shape
  // where Playwright merged the duplicate entries and the shape where it did
  // not. The extractor must produce identical output from either.
  {
    const combined = path.join(BLOBS_DIR, 'rerun');
    mkdirSync(combined, { recursive: true });

    const initial = path.join(BLOBS_DIR, 'rerun-initial');
    runToBlob('merge-rerun', initial);
    collectBlobs(initial, combined, '01');

    const rerun = path.join(BLOBS_DIR, 'rerun-again');
    runToBlob('merge-rerun', rerun, ['--grep', 'MRG-02|MRG-04'], {
      IS_RERUN: '1',
    });
    collectBlobs(rerun, combined, '02');

    // rootDir is the resolved testDir, i.e. report-src/specs.
    merge(combined, REPORTS.mergeRerunUnmerged, REPORT_SRC_DIR);
    merge(
      combined,
      REPORTS.mergeRerunMerged,
      path.join(REPORT_SRC_DIR, 'specs')
    );
  }

  for (const name of Object.values(REPORTS)) verify(name);

  // Non-report inputs for the loader's error paths. Not Playwright output and
  // not pretending to be: one unparseable file, and a path left absent.
  writeFileSync(scratchPath('not-a-report.json'), 'this is not json\n');

  rmSync(BLOBS_DIR, { recursive: true, force: true });
  for (const dir of ['test-results', 'playwright-report', 'blob-report']) {
    rmSync(path.join(REPORT_SRC_DIR, dir), { recursive: true, force: true });
  }
}
