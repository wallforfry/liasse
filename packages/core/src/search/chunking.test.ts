import { describe, expect, it } from 'vitest';
import {
  ChunkBudgetError,
  type ChunkingOptions,
  CHUNK_MAX_TOKENS,
  CHUNK_OVERLAP_TOKENS,
  chunkPages,
  type CountTokens,
  embeddingInput,
} from './chunking.ts';

// Counters that make the arithmetic exact: one token per word, or one per character.
const wordsIn = (text: string): number => text.split(/\s+/u).filter((word) => word !== '').length;
const countWords: CountTokens = (texts) => Promise.resolve(texts.map(wordsIn));
const countCharacters: CountTokens = (texts) =>
  Promise.resolve(texts.map((text) => Array.from(text).length));

// Five words, so five tokens for the word counter.
const sentence = (index: number): string => `Fact number ${String(index)} is stated. `;

const sentences = (count: number, from = 0): string =>
  Array.from({ length: count }, (_, index) => sentence(from + index)).join('');

const chunkTexts = async (text: string, options: ChunkingOptions = {}) =>
  (await chunkPages([{ page: 1, text }], { countTokens: countWords, ...options })).map(
    (chunk) => chunk.text,
  );

// Length of the longest text that ends `left` and starts `right`.
const overlapLength = (left: string, right: string): number =>
  Array.from({ length: Math.min(left.length, right.length) }, (_, index) => index + 1)
    .filter((length) => left.endsWith(right.slice(0, length)))
    .at(-1) ?? 0;

const overlaps = (chunks: readonly string[]): readonly number[] =>
  chunks
    .slice(1)
    .map((chunk, index) => wordsIn(chunk.slice(0, overlapLength(chunks[index] ?? '', chunk))));

describe('chunkPages', () => {
  it('follows the spec: 800 tokens per chunk at most, 100 tokens of overlap', () => {
    expect([CHUNK_MAX_TOKENS, CHUNK_OVERLAP_TOKENS]).toEqual([800, 100]);
  });

  it('keeps a short page as one trimmed chunk on its page', async () => {
    expect(await chunkPages([{ page: 3, text: '  Total due: 84.20 EUR\n' }])).toEqual([
      { pageFrom: 3, pageTo: 3, text: 'Total due: 84.20 EUR' },
    ]);
  });

  it('chunks page by page and never merges two pages', async () => {
    expect(
      await chunkPages([
        { page: 1, text: 'First page.' },
        { page: 2, text: 'Second page.' },
      ]),
    ).toEqual([
      { pageFrom: 1, pageTo: 1, text: 'First page.' },
      { pageFrom: 2, pageTo: 2, text: 'Second page.' },
    ]);
  });

  it('produces no chunk for a blank page', async () => {
    expect(await chunkPages([{ page: 1, text: ' \n\t\n ' }])).toEqual([]);
  });

  it('splits a long page into chunks of 800 tokens at most, as full as the sentences allow', async () => {
    const chunks = await chunkPages([{ page: 2, text: sentences(1000) }], {
      countTokens: countWords,
    });
    const sizes = chunks.map((chunk) => wordsIn(chunk.text));
    expect(sizes.length).toBeGreaterThan(6);
    expect(Math.max(...sizes)).toBe(800);
    expect(Math.min(...sizes.slice(0, -1))).toBe(800);
    expect(chunks.every((chunk) => chunk.pageFrom === 2 && chunk.pageTo === 2)).toBe(true);
  });

  it('repeats 100 tokens of the previous chunk at the start of the next', async () => {
    const chunks = await chunkTexts(sentences(1000));
    expect(new Set(overlaps(chunks))).toEqual(new Set([100]));
  });

  it('never lets the overlap take more than a quarter of a chunk', async () => {
    const chunks = await chunkTexts(sentences(200), { maxTokens: 40, overlapTokens: 100 });
    expect(new Set(overlaps(chunks))).toEqual(new Set([10]));
    expect(Math.max(...chunks.map(wordsIn))).toBe(40);
  });

  it('loses no text: the chunks without their overlap rebuild the page', async () => {
    const page = sentences(1000).trim();
    const chunks = await chunkTexts(page);
    const rebuilt = chunks.reduce(
      (text, chunk) => `${text} ${chunk.slice(overlapLength(text, chunk)).trimStart()}`.trim(),
      '',
    );
    expect(rebuilt).toBe(page);
  });

  it('cuts between paragraphs before it cuts between the lines of one', async () => {
    const paragraph = (name: string): string =>
      `${name} line one of five\n${name} line two of five`;
    const paragraphs = ['First', 'Second', 'Third'].map(paragraph);
    expect(await chunkTexts(paragraphs.join('\n\n'), { maxTokens: 25, overlapTokens: 0 })).toEqual([
      `${paragraphs[0] ?? ''}\n\n${paragraphs[1] ?? ''}`,
      paragraphs[2],
    ]);
  });

  it('cuts between lines before it cuts inside one', async () => {
    const lines = Array.from({ length: 12 }, (_, index) => `REF ${String(index)} | 12 EUR`);
    const chunks = await chunkTexts(lines.join('\n'), { maxTokens: 12, overlapTokens: 0 });
    expect(chunks).toEqual([
      lines.slice(0, 2).join('\n'),
      lines.slice(2, 4).join('\n'),
      lines.slice(4, 6).join('\n'),
      lines.slice(6, 8).join('\n'),
      lines.slice(8, 10).join('\n'),
      lines.slice(10, 12).join('\n'),
    ]);
  });

  it('cuts between sentences inside a paragraph that does not fit', async () => {
    const chunks = await chunkTexts(sentences(200), { maxTokens: 103, overlapTokens: 11 });
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.every((chunk) => /^Fact number \d+ is/.test(chunk) && chunk.endsWith('.'))).toBe(
      true,
    );
  });

  it('cuts after a CJK full stop, which no space follows', async () => {
    const chunks = await chunkPages([{ page: 1, text: '甲乙丙丁戊己。'.repeat(30) }], {
      maxTokens: 52,
      overlapTokens: 0,
      countTokens: countCharacters,
    });
    expect(chunks.map((chunk) => chunk.text.length)).toEqual([49, 49, 49, 49, 14]);
    expect(chunks.every((chunk) => chunk.text.endsWith('。'))).toBe(true);
  });

  it('cuts between words inside a sentence that does not fit', async () => {
    const words = Array.from({ length: 300 }, (_, index) => `word${String(index)}`);
    const chunks = await chunkTexts(words.join(' '), { maxTokens: 50, overlapTokens: 0 });
    expect(chunks.map(wordsIn)).toEqual([50, 50, 50, 50, 50, 50]);
    expect(chunks.flatMap((chunk) => chunk.split(' '))).toEqual(words);
  });

  it('cuts a run without any boundary in halves, without splitting a surrogate pair', async () => {
    const blob = `a${'😀'.repeat(101)}`;
    const chunks = await chunkPages([{ page: 1, text: blob }], {
      maxTokens: 25,
      overlapTokens: 0,
      countTokens: countCharacters,
    });
    const texts = chunks.map((chunk) => chunk.text);
    expect(texts.join('')).toBe(blob);
    expect(Math.max(...texts.map((text) => Array.from(text).length))).toBeLessThanOrEqual(25);
    expect(
      texts.every((text) =>
        Array.from(text).every((character) => character === 'a' || character === '😀'),
      ),
    ).toBe(true);
  });

  it('cuts again with a smaller budget when the pieces count for more once joined', async () => {
    // One extra token per ten words: a chunk of small pieces costs more than their sum.
    const growing: CountTokens = (texts) =>
      Promise.resolve(texts.map((text) => wordsIn(text) + Math.floor(wordsIn(text) / 10)));
    const chunks = await chunkPages([{ page: 1, text: sentences(300) }], {
      maxTokens: 100,
      countTokens: growing,
    });
    const [sizes] = await Promise.all([growing(chunks.map((chunk) => chunk.text))]);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(100);
    expect(Math.max(...sizes)).toBeGreaterThan(80);
  });

  it('rejects a counter that does not answer for every text', async () => {
    const failure = chunkPages([{ page: 1, text: 'Some text.' }], {
      countTokens: () => Promise.resolve([]),
    });
    await expect(failure).rejects.toBeInstanceOf(ChunkBudgetError);
  });

  it('estimates the tokens when it is given no counter, more of them for dense text', async () => {
    const prose = await chunkPages([{ page: 1, text: 'word '.repeat(2000) }]);
    const numbers = await chunkPages([{ page: 1, text: '1234 '.repeat(2000) }]);
    expect(prose.length).toBeGreaterThan(2);
    expect(numbers.length).toBeGreaterThan(prose.length);
  });

  it('is deterministic', async () => {
    const pages = [{ page: 1, text: sentences(700) }];
    expect(await chunkPages(pages)).toEqual(await chunkPages(pages));
  });

  it.each([
    { maxTokens: 3, overlapTokens: 0 },
    { maxTokens: 10.5, overlapTokens: 0 },
    { maxTokens: 100, overlapTokens: -1 },
    { maxTokens: 100, overlapTokens: 1.5 },
  ])('rejects the budget %j', async (options) => {
    await expect(chunkPages([], options)).rejects.toBeInstanceOf(RangeError);
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

  it('cuts a title that would crowd the text out of the model window', () => {
    const input = embeddingInput('text', { title: 'T'.repeat(500), typeSlug: null });
    expect(input).toBe(`Title: ${'T'.repeat(200)}\n\ntext`);
  });
});
