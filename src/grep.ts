import type { FailedTest } from './extract.js';

export interface GrepOptions {
  /** Extract a short id from the test's own title; omit to use escaped full titles (default: undefined) */
  idPattern?: RegExp;
  /** Joiner between alternatives (default: '|'). Only '|' produces real regex
   *  alternation - a custom separator is joined literally into the pattern
   *  string, so it will not select multiple tests unless it is itself a
   *  meaningful regex construct. */
  separator?: string;
  /** Drop duplicate ids (default: true) */
  unique?: boolean;
  /** What to do when idPattern matches nothing (default: 'title') */
  onUnmatched?: 'title' | 'skip' | 'throw';
}

const DEFAULT_SEPARATOR = '|';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build a single regular-expression string suitable for Playwright's
 * `--grep`/`-g` flag from a list of FailedTests - the replacement for
 * `save_failed_tests.sh`'s pipe-joined `failed_tests.txt` contract.
 *
 * `idPattern`, when given, is matched against the test's OWN title (the last
 * element of `titlePath`), never the joined `title` - matching against the
 * joined path could pick an id out of the file path or a describe title
 * instead of the test itself.
 *
 * Every entry is regex-escaped, whether it came from an `idPattern` match or
 * the full-title fallback: an id is expected to be escape-safe already (a
 * no-op), and an unescaped fallback title could contain the separator itself
 * - most dangerously '|', which would silently widen the alternation - or
 * other regex metacharacters.
 *
 * @example
 * ```ts
 * toGrepPattern(failed, { idPattern: /[A-Z][A-Z0-9]*-\d+/ });
 * // "CBRO-02|CAM2-03"
 * ```
 */
export function toGrepPattern(
  failed: FailedTest[],
  options?: GrepOptions
): string {
  const separator = options?.separator ?? DEFAULT_SEPARATOR;
  const unique = options?.unique ?? true;
  const onUnmatched = options?.onUnmatched ?? 'title';
  const idPattern = options?.idPattern;

  const entries: string[] = [];
  const seen = new Set<string>();

  for (const test of failed) {
    const ownTitle = test.titlePath[test.titlePath.length - 1] ?? test.title;
    let raw: string | undefined;

    if (idPattern) {
      const match = ownTitle.match(idPattern);
      if (match) {
        raw = match[0];
      } else if (onUnmatched === 'throw') {
        throw new Error(
          `playwright-report-analyzer: no id match for "${ownTitle}"`
        );
      } else if (onUnmatched === 'skip') {
        continue;
      } else {
        raw = ownTitle;
      }
    } else {
      raw = ownTitle;
    }

    const entry = escapeRegExp(raw);

    if (unique) {
      const key = idPattern ? raw : entry;
      if (seen.has(key)) continue;
      seen.add(key);
    }

    entries.push(entry);
  }

  return entries.join(separator);
}
