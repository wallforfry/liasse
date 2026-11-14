import { describe, expect, it } from 'vitest';
import { parseXml, type XmlElement, type XmlLimits } from './xml.ts';

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

  // A run of characters without `=` used to be retried from each of its offsets: 1 s for
  // 40 000 characters, 5 s for 80 000. A linear scan takes well under a millisecond for
  // both, so the constant term only absorbs timer noise.
  it('scans a tag in time proportional to its length', () => {
    const timeOf = (length: number): number => {
      const xml = `<w:p ${'a'.repeat(length)}/>`;
      const start = performance.now();
      parseXml(xml, NO_LIMITS);
      return performance.now() - start;
    };
    timeOf(40_000);
    const single = timeOf(40_000);
    const double = timeOf(80_000);
    expect(double).toBeLessThan(3 * single + 50);
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
