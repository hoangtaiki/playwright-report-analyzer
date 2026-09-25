import { test, expect } from '@playwright/test';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { isEntrypoint, run } from '../src/cli.js';
import {
  PACKAGE_ROOT,
  REPORTS,
  reportPath,
  scratchPath,
} from './support/reports.js';

function captureConsole() {
  const out: string[] = [];
  const err: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (msg?: unknown) => out.push(String(msg));
  console.error = (msg?: unknown) => err.push(String(msg));
  return {
    out,
    err,
    restore: () => {
      console.log = origLog;
      console.error = origErr;
    },
  };
}

/** Invoke the CLI in-process, so its exit code and output are assertable
 *  without spawning a child. */
function cli(argv: string[]) {
  const cap = captureConsole();
  let code: number;
  try {
    code = run(argv);
  } finally {
    cap.restore();
  }
  return { code, out: cap.out, err: cap.err };
}

/** The --grep output is an unordered alternation. Order is an artefact of
 *  report layout, not part of the contract, so assert on the set. */
const idsIn = (pattern: string) => pattern.trim().split('|').sort();

test.describe('CLI - exit codes', () => {
  test('should exit 0 and print JSON when tests failed (a reporting tool, not a gate)', () => {
    const { code, out } = cli([reportPath(REPORTS.structural)]);
    expect(code).toBe(0);
    const parsed = JSON.parse(out[0]);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
  });

  test('should exit 1 for a missing report file', () => {
    expect(cli([scratchPath('does-not-exist.json')]).code).toBe(1);
  });

  test('should exit 1 for a report that is not JSON', () => {
    expect(cli([scratchPath('not-a-report.json')]).code).toBe(1);
  });

  test('should exit 2 with no arguments', () => {
    expect(cli([]).code).toBe(2);
  });

  test('should exit 2 for an invalid --id-pattern', () => {
    const { code } = cli([
      reportPath(REPORTS.structural),
      '--grep',
      '--id-pattern',
      '(unterminated',
    ]);
    expect(code).toBe(2);
  });

  test('should print report errors to stderr without affecting the exit code', () => {
    // A spec file that failed to import means zero failures and a broken
    // build. The CLI must not let that look like a clean run, but it also
    // must not turn a reporting step into a build gate.
    const { code, err } = cli([reportPath(REPORTS.reportErrors)]);
    expect(code).toBe(0);
    expect(err.join('\n')).toContain('top-level error');
  });
});

test.describe('CLI - output', () => {
  test('should emit a --grep pattern instead of JSON', () => {
    const { code, out } = cli([
      reportPath(REPORTS.mergeMultiproject),
      '--grep',
      '--id-pattern',
      '[A-Z][A-Z0-9]*-\\d+',
    ]);
    expect(code).toBe(0);
    // MRG-01 fails on project-b only, MRG-03 on both - and the pattern is
    // deduped, so each id appears exactly once however many projects failed.
    expect(idsIn(out[0])).toEqual(['MRG-01', 'MRG-03']);
  });

  test('should omit a test that a rerun already cleared', () => {
    const { out } = cli([
      reportPath(REPORTS.mergeRerunUnmerged),
      '--grep',
      '--id-pattern',
      '[A-Z][A-Z0-9]*-\\d+',
    ]);
    expect(idsIn(out[0])).toEqual(['MRG-04']);
  });

  test('should write output to a file when --out is given', () => {
    const outFile = path.join(
      PACKAGE_ROOT,
      'test-results',
      `cli-out-${Date.now()}.txt`
    );
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    const { code } = cli([
      reportPath(REPORTS.mergeMultiproject),
      '--grep',
      '--id-pattern',
      '[A-Z][A-Z0-9]*-\\d+',
      '--out',
      outFile,
    ]);
    expect(code).toBe(0);
    expect(idsIn(fs.readFileSync(outFile, 'utf-8'))).toEqual([
      'MRG-01',
      'MRG-03',
    ]);
    fs.rmSync(outFile);
  });

  test('should include flaky tests when --include-flaky is given', () => {
    const withoutFlaky = JSON.parse(
      cli([reportPath(REPORTS.structural)]).out[0]
    );
    const withFlaky = JSON.parse(
      cli([reportPath(REPORTS.structural), '--include-flaky']).out[0]
    );
    expect(withFlaky.length).toBe(withoutFlaky.length + 1);
  });

  test('--summary should print the computed totals, not the failed-tests array', () => {
    const { code, out } = cli([
      reportPath(REPORTS.mergeRerunUnmerged),
      '--summary',
    ]);
    expect(code).toBe(0);
    const summary = JSON.parse(out[0]);
    // Two tests behind the merge: one still failing, one cleared by rerun.
    expect(summary).toMatchObject({
      total: 2,
      passed: 0,
      failed: 1,
      flaky: 1,
      skipped: 0,
      ok: false,
    });
  });

  test('--full should print both the summary and the failed-tests list, in agreement', () => {
    const { code, out } = cli([
      reportPath(REPORTS.mergeRerunUnmerged),
      '--full',
    ]);
    expect(code).toBe(0);
    const { summary, failed } = JSON.parse(out[0]);
    expect(failed.length).toBe(summary.failed);
    expect(
      failed.some((f: { title: string }) => f.title.includes('MRG-04'))
    ).toBe(true);
  });

  test('--grep should take precedence when combined with --summary or --full', () => {
    const { out } = cli([
      reportPath(REPORTS.mergeRerunUnmerged),
      '--summary',
      '--grep',
      '--id-pattern',
      '[A-Z][A-Z0-9]*-\\d+',
    ]);
    expect(idsIn(out[0])).toEqual(['MRG-04']);
  });
});

test.describe('CLI - entrypoint detection', () => {
  // npm installs a `bin` as a symlink in node_modules/.bin, so process.argv[1]
  // is the symlink while import.meta.url is the resolved real path. Comparing
  // them naively makes the installed CLI exit 0 having printed nothing - the
  // exact silent failure this package exists to prevent.
  test('should detect the entrypoint when invoked through a bin symlink', () => {
    const target = path.join(PACKAGE_ROOT, 'src', 'cli.ts');
    const link = scratchPath(`bin-link-${Date.now()}`);
    try {
      fs.symlinkSync(target, link);
    } catch (err) {
      // Windows refuses file symlinks without elevation or Developer Mode.
      // The behaviour under test is not platform-specific, so skipping beats
      // either a red build or a silently weakened assertion.
      const code = (err as NodeJS.ErrnoException).code;
      test.skip(
        code === 'EPERM' || code === 'EACCES',
        `cannot create a symlink on this platform (${code})`
      );
      throw err;
    }
    try {
      expect(isEntrypoint(link, pathToFileURL(target).href)).toBe(true);
    } finally {
      fs.rmSync(link);
    }
  });

  test('should detect the entrypoint when invoked by its real path', () => {
    const target = path.join(PACKAGE_ROOT, 'src', 'cli.ts');
    expect(isEntrypoint(target, pathToFileURL(target).href)).toBe(true);
  });

  test('should not fire for an unrelated entrypoint', () => {
    const target = path.join(PACKAGE_ROOT, 'src', 'cli.ts');
    expect(
      isEntrypoint(target, pathToFileURL(scratchPath('other.js')).href)
    ).toBe(false);
  });

  test('should not throw when argv[1] is absent or unresolvable', () => {
    expect(isEntrypoint(undefined, 'file:///whatever')).toBe(false);
    expect(isEntrypoint(scratchPath('no-such-file'), 'file:///whatever')).toBe(
      false
    );
  });
});
