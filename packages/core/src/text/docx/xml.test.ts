import { describe, expect, it } from 'vitest';
import { parseAttributes, parseXml, type XmlElement, type XmlLimits } from './xml.ts';

const NO_LIMITS = { maxNodes: Number.MAX_SAFE_INTEGER, maxTextChars: Number.MAX_SAFE_INTEGER };
const withNodes = (maxNodes: number): XmlLimits => ({ ...NO_LIMITS, maxNodes });

const firstElement = (xml: string): XmlElement | undefined =>
  parseXml(xml, NO_LIMITS).children.find((child) => typeof child !== 'string');

describe('parseXml attributes', () => {
  it('reads quoted attributes and decodes their entities', () => {
    expect(firstElement(`<w:p w:a="1"  w:b = '2 &amp; 3'\n w:c="x>y"/>`)?.attributes).toEqual({
      'w:a': '1',
      'w:b': '2 & 3',
      'w:c': 'x>y',
    });
  });

  it('stops at the first thing that is not an attribute', () => {
    expect(firstElement('<w:p w:a="1" stray w:b="2"/>')?.attributes).toEqual({ 'w:a': '1' });
  });
});

// What the scanner was before its steps were counted: one sticky pattern per attribute.
const FORMER_ATTRIBUTE = /\s*([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/y;

const formerAttributes = (source: string): Readonly<Record<string, string>> => {
  const attributes: [string, string][] = [];
  FORMER_ATTRIBUTE.lastIndex = 0;
  for (
    let match = FORMER_ATTRIBUTE.exec(source);
    match !== null;
    match = FORMER_ATTRIBUTE.exec(source)
  ) {
    attributes.push([match[1] ?? '', match[2] ?? match[3] ?? '']);
  }
  return Object.fromEntries(attributes);
};

// Well-formed attributes and everything that can go wrong between them.
const FRAGMENTS = [
  ' a="1"',
  " b='2'",
  'c = "x y"',
  ' d=""',
  '\n\te\n=\n"f"',
  ` g='h"i'`,
  ' a="again"',
  ' stray',
  ' =',
  '="j"',
  ' k=l',
  ' m="unterminated',
  '"',
  "'",
  ' ',
  '/',
];

const sequencesOf = (length: number): readonly string[] =>
  length === 0
    ? ['']
    : sequencesOf(length - 1).flatMap((start) => FRAGMENTS.map((fragment) => start + fragment));

const stepsOf = (source: string): number => {
  let steps = 0;
  parseAttributes(source, (examined) => {
    steps += examined;
  });
  return steps;
};

describe('parseAttributes', () => {
  it('reads what the single sticky pattern read, for every sequence of three fragments', () => {
    const sources = [0, 1, 2, 3].flatMap(sequencesOf);
    const differing = sources.filter(
      (source) =>
        JSON.stringify(parseAttributes(source)) !== JSON.stringify(formerAttributes(source)),
    );
    expect(sources).toHaveLength(1 + 16 + 16 ** 2 + 16 ** 3);
    expect(differing).toEqual([]);
  });

  // A run without `=` used to be retried from each of its offsets, which is quadratic:
  // 1 s for 40 000 characters, 5 s for 80 000. The scanner reports every character it
  // reads, so the count is the work done, whatever the load of the machine. The lower
  // bound holds because each of these inputs has to be read to its end.
  it.each<[string, (length: number) => string]>([
    ['a run of characters without =', (length) => ` ${'a'.repeat(length)}`],
    ['a run of spaces', (length) => ' '.repeat(length)],
    ['a quoted value that never ends', (length) => ` a="${'b'.repeat(length)}`],
    ['one long value', (length) => ` a="${'b'.repeat(length)}"`],
    ['many attributes', (length) => ' a="1"'.repeat(length / 6)],
    ['many names spread over lines', (length) => '\n a\n =\n "1"'.repeat(length / 12)],
  ])('reads %s in steps proportional to its length', (_case, build) => {
    const single = stepsOf(build(40_000));
    const double = stepsOf(build(80_000));
    expect(single).toBeGreaterThanOrEqual(build(40_000).length);
    expect(double).toBeLessThanOrEqual(2 * single + 16);
  });

  it('reports nothing it does not read: a scan that stops early costs a few steps', () => {
    expect(stepsOf(` stray ${'a="1" '.repeat(10_000)}`)).toBeLessThan(16);
  });
});

describe('parseXml node limit', () => {
  const elements = (count: number): string => `<r>${'<a/>'.repeat(count - 1)}</r>`;

  it('accepts a document with exactly as many nodes as the limit', () => {
    expect(firstElement(elements(10))?.children).toHaveLength(9);
    expect(parseXml(elements(10), withNodes(10)).children).toHaveLength(1);
  });

  it('refuses one node more than the limit', () => {
    expect(() => parseXml(elements(11), withNodes(10))).toThrow(
      expect.objectContaining({ code: 'docx_too_large' }),
    );
    expect(() => parseXml(elements(11), withNodes(10))).toThrow(/more than the limit of 10 nodes/);
  });

  it('counts text nodes', () => {
    expect(parseXml('<r>one<a/>two</r>', withNodes(4)).children).toHaveLength(1);
    expect(() => parseXml('<r>one<a/>two</r>', withNodes(3))).toThrow(
      expect.objectContaining({ code: 'docx_too_large' }),
    );
  });
});
