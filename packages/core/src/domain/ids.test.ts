import { describe, expect, it } from 'vitest';
import { createUlidGenerator, ID_PREFIXES, newId } from './ids.ts';

describe('newId', () => {
  it('prefixes a 26-character Crockford base32 ULID', () => {
    expect(newId(ID_PREFIXES.document)).toMatch(/^doc_[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('never returns the same id twice', () => {
    const ids = Array.from({ length: 1000 }, () => newId(ID_PREFIXES.job));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('createUlidGenerator', () => {
  it('encodes the clock in the first ten characters', () => {
    const ulid = createUlidGenerator(() => 0);
    expect(ulid().slice(0, 10)).toBe('0000000000');
  });

  it('sorts lexicographically in creation order within one millisecond', () => {
    const ulid = createUlidGenerator(() => 1_700_000_000_000);
    const ids = Array.from({ length: 500 }, () => ulid());
    expect(ids.toSorted()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('stays monotonic when the clock moves backwards', () => {
    const times = [2000, 1000, 500];
    const ulid = createUlidGenerator(() => times.shift() ?? 0);
    const ids = [ulid(), ulid(), ulid()];
    expect(ids.toSorted()).toEqual(ids);
  });

  it('sorts by time across milliseconds', () => {
    const times = [1000, 2000];
    const ulid = createUlidGenerator(() => times.shift() ?? 0);
    const first = ulid();
    const second = ulid();
    expect(first < second).toBe(true);
  });
});
