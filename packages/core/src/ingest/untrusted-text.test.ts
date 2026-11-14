import { describe, expect, it } from 'vitest';
import { MAX_FILENAME_LENGTH, MAX_HINT_LENGTH } from '../domain/limits.ts';
import { cleanFilename, cleanHint } from './untrusted-text.ts';

describe('cleanFilename', () => {
  it.each([
    ['invoice.pdf', 'invoice.pdf'],
    ['/home/synthetic/inbox/invoice.pdf', 'invoice.pdf'],
    ['C:\\Users\\synthetic\\invoice.pdf', 'invoice.pdf'],
    ['../../etc/passwd', 'passwd'],
    ['  spaced name.pdf  ', 'spaced name.pdf'],
    ['line\nbreak\0.pdf', 'linebreak.pdf'],
    ['relevé d’électricité.pdf', 'relevé d’électricité.pdf'],
  ])('turns %j into %j', (given, expected) => {
    expect(cleanFilename(given)).toBe(expected);
  });

  it.each([[''], ['   '], ['inbox/'], ['\0\n']])('names %j when nothing is left', (given) => {
    expect(cleanFilename(given)).toBe('unnamed');
  });

  it('cuts a long name', () => {
    expect(cleanFilename('x'.repeat(1000))).toHaveLength(MAX_FILENAME_LENGTH);
  });

  it('removes an unpaired surrogate', () => {
    expect(cleanFilename('a\ud83db.pdf')).toBe('ab.pdf');
  });
});

describe('cleanHint', () => {
  it('keeps an ordinary hint, trimmed', () => {
    expect(cleanHint('  Electricity bill,\nOctober  ')).toBe('Electricity bill,\nOctober');
  });

  it('drops a missing or blank hint', () => {
    expect(cleanHint(undefined)).toBeUndefined();
    expect(cleanHint(' \n ')).toBeUndefined();
  });

  it('cuts a long hint', () => {
    expect(cleanHint('x'.repeat(MAX_HINT_LENGTH + 500))).toHaveLength(MAX_HINT_LENGTH);
  });

  it('does not leave half a surrogate pair at the cut', () => {
    const hint = `${'x'.repeat(MAX_HINT_LENGTH - 1)}😀`;
    expect(cleanHint(hint)).toBe('x'.repeat(MAX_HINT_LENGTH - 1));
  });

  it('removes NUL characters and keeps whole emoji', () => {
    expect(cleanHint('a\0b 😀')).toBe('ab 😀');
  });
});
