import { test, expect } from '@playwright/test';
import { toGrepPattern } from '../src/grep.js';
import type { FailedTest } from '../src/extract.js';

function makeFailedTest(overrides: Partial<FailedTest> = {}): FailedTest {
  return {
    title: 'specs/foo.spec.ts > FOO-01: does a thing',
    titlePath: ['specs/foo.spec.ts', 'FOO-01: does a thing'],
    tags: [],
    retries: 0,
    status: 'failed',
    ...overrides,
  };
}

test.describe('toGrepPattern - id extraction', () => {
  test('should extract NF-style ids and join with the default separator', () => {
    const failed = [
      makeFailedTest({
        title: 'specs/a.spec.ts > CBRO-02: a thing',
        titlePath: ['specs/a.spec.ts', 'CBRO-02: a thing'],
      }),
      makeFailedTest({
        title: 'specs/b.spec.ts > CAM2-03: another thing',
        titlePath: ['specs/b.spec.ts', 'CAM2-03: another thing'],
      }),
    ];
    const pattern = toGrepPattern(failed, { idPattern: /[A-Z][A-Z0-9]*-\d+/ });
    expect(pattern).toBe('CBRO-02|CAM2-03');
  });

  test('should match the id against the test’s own title, not the file path or a describe title', () => {
    const failed = [
      makeFailedTest({
        title: 'specs/nfplus/ABC-99.spec.ts > NCRT-01: real test id',
        titlePath: ['specs/nfplus/ABC-99.spec.ts', 'NCRT-01: real test id'],
      }),
    ];
    const pattern = toGrepPattern(failed, { idPattern: /[A-Z][A-Z0-9]*-\d+/ });
    expect(pattern).toBe('NCRT-01');
  });

  test('should fall back to an escaped full title when no idPattern is given', () => {
    // toGrepPattern reads the LAST element of titlePath (the test's own
    // title), not the joined `title` string, so both must be overridden
    // together here.
    const ownTitle = 'has (parens) and a dot.';
    const failed = [
      makeFailedTest({
        title: `specs/a.spec.ts > ${ownTitle}`,
        titlePath: ['specs/a.spec.ts', ownTitle],
      }),
    ];
    const pattern = toGrepPattern(failed);
    expect(pattern).toBe('has \\(parens\\) and a dot\\.');
  });
});

test.describe('toGrepPattern - onUnmatched', () => {
  const noIdTest = makeFailedTest({
    title: 'specs/a.spec.ts > a title with no id',
    titlePath: ['specs/a.spec.ts', 'a title with no id'],
  });

  test('should fall back to the escaped title by default', () => {
    const pattern = toGrepPattern([noIdTest], {
      idPattern: /[A-Z][A-Z0-9]*-\d+/,
    });
    expect(pattern).toBe('a title with no id');
  });

  test('should skip the test when onUnmatched is skip', () => {
    const pattern = toGrepPattern([noIdTest], {
      idPattern: /[A-Z][A-Z0-9]*-\d+/,
      onUnmatched: 'skip',
    });
    expect(pattern).toBe('');
  });

  test('should throw when onUnmatched is throw', () => {
    expect(() =>
      toGrepPattern([noIdTest], {
        idPattern: /[A-Z][A-Z0-9]*-\d+/,
        onUnmatched: 'throw',
      })
    ).toThrow(/no id match/);
  });
});

test.describe('toGrepPattern - unique', () => {
  test('should dedupe on the extracted id across projects by default', () => {
    const failed = [
      makeFailedTest({
        title: 'specs/a.spec.ts > MRG-03: fails everywhere',
        titlePath: ['specs/a.spec.ts', 'MRG-03: fails everywhere'],
        project: 'chromium',
      }),
      makeFailedTest({
        title: 'specs/a.spec.ts > MRG-03: fails everywhere',
        titlePath: ['specs/a.spec.ts', 'MRG-03: fails everywhere'],
        project: 'webkit',
      }),
    ];
    const pattern = toGrepPattern(failed, { idPattern: /[A-Z][A-Z0-9]*-\d+/ });
    expect(pattern).toBe('MRG-03');
  });

  test('should keep duplicates when unique is false', () => {
    const failed = [
      makeFailedTest({
        title: 'MRG-03: fails everywhere',
        titlePath: ['MRG-03: fails everywhere'],
      }),
      makeFailedTest({
        title: 'MRG-03: fails everywhere',
        titlePath: ['MRG-03: fails everywhere'],
      }),
    ];
    const pattern = toGrepPattern(failed, {
      idPattern: /[A-Z][A-Z0-9]*-\d+/,
      unique: false,
    });
    expect(pattern).toBe('MRG-03|MRG-03');
  });
});

test.describe('toGrepPattern - separator handling', () => {
  test('should escape a literal separator character inside a fallback title', () => {
    const failed = [
      makeFailedTest({
        title: 'a title with a | pipe in it',
        titlePath: ['a title with a | pipe in it'],
      }),
    ];
    const pattern = toGrepPattern(failed);
    expect(pattern).toBe('a title with a \\| pipe in it');
  });

  test('should join alternatives with a custom separator', () => {
    const failed = [
      makeFailedTest({ title: 'AAA-01', titlePath: ['AAA-01'] }),
      makeFailedTest({ title: 'BBB-02', titlePath: ['BBB-02'] }),
    ];
    const pattern = toGrepPattern(failed, {
      idPattern: /[A-Z]+-\d+/,
      separator: ',',
    });
    expect(pattern).toBe('AAA-01,BBB-02');
  });
});

test.describe('toGrepPattern - edge cases', () => {
  test('should return an empty string for no failed tests', () => {
    expect(toGrepPattern([])).toBe('');
  });
});
