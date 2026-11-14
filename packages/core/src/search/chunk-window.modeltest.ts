import { afterAll, describe, expect, it } from 'vitest';
import { createLocalEmbedder } from '../embeddings/local.ts';
import { MODEL_CACHE_DIR } from '../embeddings/model-cache.fixture.ts';
import type { Embedding } from '../models/ports.ts';
import { chunkingFor } from './chunk-budget.ts';
import { chunkPages, embeddingInput } from './chunking.ts';

const cosine = (left: Embedding, right: Embedding): number =>
  left.reduce((sum, value, index) => sum + value * (right[index] ?? 0), 0);

const CONTEXT = { title: 'Contrat de bail et pièces annexes', typeSlug: 'lease_contract' };

const PAGES = {
  'French prose': Array.from(
    { length: 120 },
    (_, index) =>
      `Article ${String(index + 1)}. Le preneur s’engage à régler le loyer et les charges ` +
      'locatives avant le cinq de chaque mois, faute de quoi des pénalités seront appliquées. ',
  ).join(''),
  'invoice lines': Array.from(
    { length: 220 },
    (_, index) =>
      `REF-2026-${String(index).padStart(6, '0')} | 12/09/2026 | Abonnement 9 kVA | ` +
      `3 x 12,48 EUR | TVA 5,5 % | ${String(40 + index)},19 EUR | PDL 0987654321${String(index)}\n`,
  ).join(''),
  'Chinese text': Array.from(
    { length: 160 },
    (_, index) =>
      `第${String(index + 1)}条：承租人应于每月五日前支付当月租金及物业管理费用，逾期将加收滞纳金。`,
  ).join(''),
} as const;

// The model reads 512 tokens: the two special tokens, `passage: `, the header, then the chunk.
const MODEL_WINDOW = 512;
const SPECIAL_TOKENS = 2;

describe('chunks sized for the local embedding model', () => {
  const embedder = createLocalEmbedder({ dimension: 384, cacheDir: MODEL_CACHE_DIR });

  afterAll(async () => {
    await embedder.close();
  });

  it.each(Object.entries(PAGES))(
    'puts every character of a page of %s inside the window of a chunk',
    async (_, page) => {
      const chunks = await chunkPages(
        [{ page: 1, text: page }],
        await chunkingFor(embedder, CONTEXT),
      );
      expect(chunks.length).toBeGreaterThan(3);

      // What the model is given, prefix included, never exceeds what it reads.
      const read = await embedder.countTokens(
        chunks.map((chunk) => `passage: ${embeddingInput(chunk.text, CONTEXT)}`),
      );
      expect(Math.max(...read) + SPECIAL_TOKENS).toBeLessThanOrEqual(MODEL_WINDOW);
      expect(Math.max(...read)).toBeGreaterThan(MODEL_WINDOW * 0.8);

      // The chunks cover the page: with none of them truncated, no character is left out.
      const covered = new Set(
        chunks.flatMap((chunk) => {
          const start = page.indexOf(chunk.text);
          return Array.from({ length: chunk.text.length }, (__, offset) => start + offset);
        }),
      );
      expect(chunks.every((chunk) => page.includes(chunk.text))).toBe(true);
      expect(covered.size).toBe(page.trimEnd().length);
    },
  );

  it.each(Object.entries(PAGES))(
    'embeds the end of a maximal chunk of %s: changing it changes the embedding',
    async (_, page) => {
      const [chunk] = await chunkPages(
        [{ page: 1, text: page }],
        await chunkingFor(embedder, CONTEXT),
      );
      if (chunk === undefined) throw new Error('expected a chunk');
      const tail = Array.from(chunk.text).slice(-12).join('');
      const changed = `${chunk.text.slice(0, -tail.length)}${Array.from(tail).reverse().join('')}`;
      expect(changed).not.toBe(chunk.text);
      const [original, modified, again] = await embedder.embed(
        [chunk.text, changed, chunk.text].map((text) => embeddingInput(text, CONTEXT)),
        'passage',
      );
      if (original === undefined || modified === undefined || again === undefined) {
        throw new Error('expected three embeddings');
      }
      expect(cosine(original, again)).toBeGreaterThan(0.999_999);
      expect(cosine(original, modified)).toBeLessThan(0.9999);
    },
  );
});
