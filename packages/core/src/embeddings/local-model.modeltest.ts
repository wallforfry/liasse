import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '@huggingface/transformers';
import { afterAll, describe, expect, it } from 'vitest';
import type { Embedding } from '../models/ports.ts';
import { createLocalEmbedder, type LocalEmbedder } from './local.ts';

const CACHE_DIR =
  process.env.EMBEDDING_CACHE_DIR ??
  fileURLToPath(new URL('../../node_modules/.cache/liasse-models', import.meta.url));

const cosine = (left: Embedding, right: Embedding): number =>
  left.reduce((sum, value, index) => sum + value * (right[index] ?? 0), 0);

const refuseNetwork = (): Promise<never> =>
  Promise.reject(new Error('network access is disabled in this test'));

describe('the local multilingual e5 model', () => {
  const embedders: LocalEmbedder[] = [];
  const networkFetch = env.fetch;

  const localEmbedder = (cacheDir: string): LocalEmbedder => {
    const embedder = createLocalEmbedder({ dimension: 384, cacheDir });
    embedders.push(embedder);
    return embedder;
  };

  afterAll(async () => {
    env.fetch = networkFetch;
    await Promise.all(embedders.map((embedder) => embedder.close()));
  });

  it('places a French sentence closer to its English translation than to an unrelated one', async () => {
    const [french, english, unrelated] = await localEmbedder(CACHE_DIR).embed(
      [
        'La facture d’électricité du mois de septembre est à régler avant le 18 octobre.',
        'The electricity bill for September must be paid before October 18.',
        'The hiking trail climbs through a pine forest to a small mountain lake.',
      ],
      'passage',
    );
    if (french === undefined || english === undefined || unrelated === undefined) {
      throw new Error('expected three embeddings');
    }
    expect(french).toHaveLength(384);
    expect(Math.hypot(...french)).toBeCloseTo(1, 5);
    expect(cosine(french, english)).toBeGreaterThan(cosine(french, unrelated) + 0.05);
  });

  it('answers a French query with the matching passage', async () => {
    const embedder = localEmbedder(CACHE_DIR);
    const [query] = await embedder.embed(['combien ai-je payé pour le courant ?'], 'query');
    const [bill, trail] = await embedder.embed(
      [
        'Electricity bill: total amount due 84.20 EUR.',
        'The hiking trail climbs through a pine forest to a small mountain lake.',
      ],
      'passage',
    );
    if (query === undefined || bill === undefined || trail === undefined) {
      throw new Error('expected three embeddings');
    }
    expect(cosine(query, bill)).toBeGreaterThan(cosine(query, trail));
  });

  it('needs no network once the model files are in the cache directory', async () => {
    env.fetch = refuseNetwork;
    const [embedding] = await localEmbedder(CACHE_DIR).embed(['hors ligne'], 'passage');
    expect(embedding).toHaveLength(384);

    // The same refusal on an empty cache proves that the stub really cuts the network.
    const emptyCache = mkdtempSync(join(tmpdir(), 'liasse-empty-model-cache-'));
    try {
      await expect(localEmbedder(emptyCache).embed(['hors ligne'], 'passage')).rejects.toThrow();
    } finally {
      rmSync(emptyCache, { recursive: true, force: true });
    }
  });
});
