import { describe, expect, it } from 'vitest';
import type { Embedder } from '../models/ports.ts';
import { createFakeEmbedder } from '../testing/fake-embedder.ts';
import { chunkingFor, EmbedderWindowError } from './chunk-budget.ts';
import type { CountTokens } from './chunking.ts';
import { estimateTokens } from './token-estimate.ts';

const countWords: CountTokens = (texts) =>
  Promise.resolve(texts.map((text) => text.split(/\s+/u).filter((word) => word !== '').length));

const embedder = (window: Partial<Pick<Embedder, 'maxInputTokens' | 'countTokens'>>): Embedder => ({
  ...createFakeEmbedder(),
  ...window,
});

// 'Title: Bail d’habitation' and 'Type: lease': five words.
const CONTEXT = { title: 'Bail d’habitation', typeSlug: 'lease' };

describe('chunkingFor', () => {
  it('leaves the spec budget to an embedder that states no window', async () => {
    expect(await chunkingFor(embedder({}), CONTEXT)).toEqual({});
    expect(await chunkingFor(embedder({ countTokens: countWords }), CONTEXT)).toEqual({
      countTokens: countWords,
    });
  });

  it('gives the chunks what the window leaves once the header and a margin are taken off', async () => {
    expect(
      await chunkingFor(embedder({ maxInputTokens: 504, countTokens: countWords }), CONTEXT),
    ).toEqual({ maxTokens: 504 - 5 - 16, countTokens: countWords });
    expect(
      await chunkingFor(embedder({ maxInputTokens: 504, countTokens: countWords }), {
        title: null,
        typeSlug: null,
      }),
    ).toEqual({ maxTokens: 504 - 16, countTokens: countWords });
  });

  it('estimates the header for an embedder that cannot count', async () => {
    const header = estimateTokens('Title: Bail d’habitation\nType: lease\n\n');
    expect(header).toBeGreaterThan(5);
    expect(await chunkingFor(embedder({ maxInputTokens: 504 }), CONTEXT)).toEqual({
      maxTokens: 504 - header - 16,
    });
  });

  it('never goes above the 800 tokens of the spec', async () => {
    expect(
      await chunkingFor(embedder({ maxInputTokens: 8192, countTokens: countWords }), CONTEXT),
    ).toEqual({ maxTokens: 800, countTokens: countWords });
  });

  it('refuses a window too small to hold a chunk', async () => {
    const failure = chunkingFor(embedder({ maxInputTokens: 52, countTokens: countWords }), CONTEXT);
    await expect(failure).rejects.toBeInstanceOf(EmbedderWindowError);
    await expect(failure).rejects.toThrow('leaves room for 31 tokens per chunk, fewer than the 32');
    expect(
      await chunkingFor(embedder({ maxInputTokens: 53, countTokens: countWords }), CONTEXT),
    ).toMatchObject({ maxTokens: 32 });
  });
});
