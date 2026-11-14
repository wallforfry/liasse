import { describe, expect, it } from 'vitest';
import {
  CHUNK_MAX_TOKENS,
  CHUNK_OVERLAP_TOKENS,
  chunkPages,
  embeddingInput,
  estimateTokens,
} from './chunking.ts';

// Twelve characters with its separator, so three tokens by the estimate.
const sentence = (index: number): string => `Fact ${String(index).padStart(4, '0')}. `;

const sentences = (count: number, from = 0): string =>
  Array.from({ length: count }, (_, index) => sentence(from + index)).join('');

const texts = (chunks: readonly { readonly text: string }[]): readonly string[] =>
  chunks.map((chunk) => chunk.text);

// Length of the longest text that ends `left` and starts `right`.
const overlapLength = (left: string, right: string): number =>
  Array.from({ length: Math.min(left.length, right.length) }, (_, index) => index + 1)
    .filter((length) => left.endsWith(right.slice(0, length)))
    .at(-1) ?? 0;

describe('estimateTokens', () => {
  it.each([
    ['', 0],
    ['abcd', 1],
    ['abcde', 2],
    ['a'.repeat(3200), 800],
  ])('counts four characters per token for %j', (text, tokens) => {
    expect(estimateTokens(text)).toBe(tokens);
  });
});

describe('chunkPages', () => {
  it('follows the spec: 800 tokens per chunk, 100 tokens of overlap', () => {
    expect([CHUNK_MAX_TOKENS, CHUNK_OVERLAP_TOKENS]).toEqual([800, 100]);
  });

  it('keeps a short page as one trimmed chunk on its page', () => {
    expect(chunkPages([{ page: 3, text: '  Total due: 84.20 EUR\n' }])).toEqual([
      { pageFrom: 3, pageTo: 3, text: 'Total due: 84.20 EUR' },
    ]);
  });

  it('chunks page by page and never merges two pages', () => {
    expect(
      chunkPages([
        { page: 1, text: 'First page.' },
        { page: 2, text: 'Second page.' },
      ]),
    ).toEqual([
      { pageFrom: 1, pageTo: 1, text: 'First page.' },
      { pageFrom: 2, pageTo: 2, text: 'Second page.' },
    ]);
  });

  it('produces no chunk for a blank page', () => {
    expect(chunkPages([{ page: 1, text: ' \n\t\n ' }])).toEqual([]);
  });

  it('splits a long page into chunks of at most 800 estimated tokens', () => {
    const chunks = chunkPages([{ page: 2, text: sentences(1000) }]);
    expect(chunks.length).toBeGreaterThan(3);
    expect(Math.max(...chunks.map((chunk) => estimateTokens(chunk.text)))).toBeLessThanOrEqual(800);
    expect(
      Math.min(...chunks.slice(0, -1).map((chunk) => estimateTokens(chunk.text))),
    ).toBeGreaterThan(700);
    expect(chunks.every((chunk) => chunk.pageFrom === 2 && chunk.pageTo === 2)).toBe(true);
  });

  it('repeats about 100 tokens of the previous chunk at the start of the next', () => {
    const chunks = texts(chunkPages([{ page: 1, text: sentences(1000) }]));
    const overlaps = chunks
      .slice(1)
      .map((chunk, index) =>
        estimateTokens(chunk.slice(0, overlapLength(chunks[index] ?? '', chunk))),
      );
    expect(Math.max(...overlaps)).toBeLessThanOrEqual(100);
    expect(Math.min(...overlaps)).toBeGreaterThan(90);
  });

  it('loses no text: the chunks without their overlap rebuild the page', () => {
    const page = sentences(1000).trim();
    const chunks = texts(chunkPages([{ page: 1, text: page }]));
    const rebuilt = chunks.reduce(
      (text, chunk) => `${text} ${chunk.slice(overlapLength(text, chunk)).trimStart()}`.trim(),
      '',
    );
    expect(rebuilt).toBe(page);
  });

  it('cuts between paragraphs when paragraphs fit', () => {
    const paragraphs = [sentences(40, 0), sentences(40, 100), sentences(40, 200)].map((text) =>
      text.trim(),
    );
    const chunks = chunkPages([{ page: 1, text: paragraphs.join('\n\n') }], {
      maxTokens: 250,
      overlapTokens: 0,
    });
    expect(texts(chunks)).toEqual([
      `${paragraphs[0] ?? ''}\n\n${paragraphs[1] ?? ''}`,
      paragraphs[2],
    ]);
  });

  it('cuts between sentences inside a paragraph that does not fit', () => {
    const chunks = texts(
      chunkPages([{ page: 1, text: sentences(200) }], { maxTokens: 100, overlapTokens: 10 }),
    );
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.every((chunk) => /^Fact \d{4}\./.test(chunk) && chunk.endsWith('.'))).toBe(true);
  });

  it('cuts between words inside a sentence that does not fit', () => {
    const words = Array.from({ length: 300 }, (_, index) => `word${String(index)}`);
    const chunks = texts(
      chunkPages([{ page: 1, text: words.join(' ') }], { maxTokens: 50, overlapTokens: 0 }),
    );
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.flatMap((chunk) => chunk.split(' '))).toEqual(words);
  });

  it('cuts a run without whitespace by length, without splitting a surrogate pair', () => {
    const blob = `a${'😀'.repeat(101)}`;
    const chunks = texts(
      chunkPages([{ page: 1, text: blob }], { maxTokens: 25, overlapTokens: 0 }),
    );
    expect(chunks.join('')).toBe(blob);
    expect(Math.max(...chunks.map(estimateTokens))).toBeLessThanOrEqual(25);
    expect(
      chunks.every((chunk) => Array.from(chunk).every((character) => 'a😀'.includes(character))),
    ).toBe(true);
  });

  it('is deterministic', () => {
    const pages = [{ page: 1, text: sentences(700) }];
    expect(chunkPages(pages)).toEqual(chunkPages(pages));
  });

  it.each([
    { maxTokens: 100, overlapTokens: 100 },
    { maxTokens: 0, overlapTokens: 0 },
    { maxTokens: 10.5, overlapTokens: 0 },
    { maxTokens: 100, overlapTokens: -1 },
  ])('rejects the budget %j', (options) => {
    expect(() => chunkPages([], options)).toThrow(RangeError);
  });
});

describe('embeddingInput', () => {
  it('prefixes the title and the type slug to the chunk text', () => {
    expect(
      embeddingInput('Total due: 84.20 EUR', { title: ' Energy bill ', typeSlug: 'energy_bill' }),
    ).toBe('Title: Energy bill\nType: energy_bill\n\nTotal due: 84.20 EUR');
  });

  it.each([
    [{ title: 'Energy bill', typeSlug: null }, 'Title: Energy bill\n\ntext'],
    [{ title: null, typeSlug: 'energy_bill' }, 'Type: energy_bill\n\ntext'],
    [{ title: '  ', typeSlug: null }, 'text'],
    [{ title: null, typeSlug: null }, 'text'],
  ])('omits what the document does not have: %j', (context, expected) => {
    expect(embeddingInput('text', context)).toBe(expected);
  });
});
