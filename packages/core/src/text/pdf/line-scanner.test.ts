import { describe, expect, it } from 'vitest';
import { createLineScanner } from './line-scanner.ts';

const scan = (maxLineBytes: number, chunks: readonly string[]): readonly string[] => {
  const lines: string[] = [];
  const scanner = createLineScanner(maxLineBytes, (line) => lines.push(line));
  chunks.forEach((chunk) => {
    scanner.push(Buffer.from(chunk, 'utf8'));
  });
  scanner.end();
  return lines;
};

describe('createLineScanner', () => {
  it('reports each line, whatever the chunks it arrives in', () => {
    expect(scan(16, ['one\ntwo\n', 'th', 'r', 'ee\nfour'])).toEqual([
      'one',
      'two',
      'three',
      'four',
    ]);
  });

  it('reports empty lines, and no last line after a final line feed', () => {
    expect(scan(16, ['one\n\ntwo\n'])).toEqual(['one', '', 'two']);
    expect(scan(16, [])).toEqual([]);
  });

  it('cuts lines at line feeds alone', () => {
    expect(scan(32, ['a\rb c d\u0085e\n'])).toEqual(['a\rb c d\u0085e']);
  });

  it('reports a line of exactly the bound and drops a longer one whole', () => {
    expect(scan(4, ['abcd\nabcde\nab\n'])).toEqual(['abcd', 'ab']);
  });

  it('does not report the end of a line longer than the bound, across chunks', () => {
    expect(scan(4, ['abc', 'def', 'gh\nok\n', 'xxxxxx', 'yy'])).toEqual(['ok']);
    expect(scan(4, ['abcdefgh', '\nok'])).toEqual(['ok']);
  });

  it('puts back together a character cut between two chunks', () => {
    const bytes = Buffer.from('é\n', 'utf8');
    const lines: string[] = [];
    const scanner = createLineScanner(8, (line) => lines.push(line));
    scanner.push(bytes.subarray(0, 1));
    scanner.push(bytes.subarray(1));
    expect(lines).toEqual(['é']);
  });
});
