import { describe, expect, it } from 'vitest';
import { normalizeText } from './normalize.ts';

describe('normalizeText', () => {
  it('removes NUL bytes', () => {
    expect(normalizeText('Jane\u0000 Doe')).toBe('Jane Doe');
  });

  it('composes characters to NFC', () => {
    expect(normalizeText('Café')).toBe('Café');
  });

  it('turns CRLF and lone CR into LF', () => {
    expect(normalizeText('one\r\ntwo\rthree')).toBe('one\ntwo\nthree');
  });

  it('collapses runs of spaces, tabs and no-break spaces inside a line', () => {
    expect(normalizeText('Total \t  84.20  EUR')).toBe('Total 84.20 EUR');
  });

  it('keeps the line structure and the indentation', () => {
    expect(normalizeText('- item\n    - nested   item\n\n| a | b |')).toBe(
      '- item\n    - nested item\n\n| a | b |',
    );
  });

  it('strips trailing whitespace and empties whitespace-only lines', () => {
    expect(normalizeText('one  \n \t \ntwo\t')).toBe('one\n\ntwo');
  });

  it('keeps at most one blank line between blocks', () => {
    expect(normalizeText('one\n\n\n\n\ntwo')).toBe('one\n\ntwo');
  });

  it('drops leading blank lines and trailing whitespace', () => {
    expect(normalizeText('\n\n  indented first line\n\n\n')).toBe('  indented first line');
  });

  it('returns an empty string for blank input', () => {
    expect(normalizeText(' \n\t\n\u0000')).toBe('');
  });
});
