import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import type { Embedding } from '../models/ports.ts';
import { createLocalEmbedder, type LocalEmbedder } from './local.ts';
import type { LocalModelLoader } from './local-model.ts';
import { modelProcessOptions, startModelProcess } from './model-process.ts';

export const MODEL_CACHE_DIR =
  process.env.EMBEDDING_CACHE_DIR ??
  fileURLToPath(new URL('../../node_modules/.cache/liasse-models', import.meta.url));

const cosine = (left: Embedding, right: Embedding): number =>
  left.reduce((sum, value, index) => sum + value * (right[index] ?? 0), 0);

const REFUSE_NETWORK = new URL('./refuse-network.fixture.ts', import.meta.url).href;

const loadOffline: LocalModelLoader = (spec) => {
  const options = modelProcessOptions(spec);
  return Promise.resolve(
    startModelProcess({
      ...options,
      execArgv: [...(options.execArgv ?? []), '--import', REFUSE_NETWORK],
    }),
  );
};

describe('the local multilingual e5 model', () => {
  const embedders: LocalEmbedder[] = [];

  const localEmbedder = (cacheDir: string, loadModel?: LocalModelLoader): LocalEmbedder => {
    const embedder = createLocalEmbedder({
      dimension: 384,
      cacheDir,
      ...(loadModel === undefined ? {} : { loadModel }),
    });
    embedders.push(embedder);
    return embedder;
  };

  afterAll(async () => {
    await Promise.all(embedders.map((embedder) => embedder.close()));
  });

  it('places a French sentence closer to its English translation than to an unrelated one', async () => {
    const [french, english, unrelated] = await localEmbedder(MODEL_CACHE_DIR).embed(
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
    const embedder = localEmbedder(MODEL_CACHE_DIR);
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

  it('counts tokens with the tokenizer of the model, special tokens excluded', async () => {
    const embedder = localEmbedder(MODEL_CACHE_DIR);
    const [empty, word, sentence] = await embedder.countTokens([
      '',
      'facture',
      'La facture d’électricité du mois de septembre.',
    ]);
    expect(empty).toBe(0);
    expect(word).toBeGreaterThanOrEqual(1);
    expect(sentence).toBeGreaterThan(8);
    expect(sentence).toBeLessThan(20);
  });

  it('reserves enough of the window for its own prefixes and special tokens', async () => {
    const embedder = localEmbedder(MODEL_CACHE_DIR);
    const prefixes = await embedder.countTokens(['query: ', 'passage: ']);
    const specialTokens = 2;
    expect(Math.max(...prefixes) + specialTokens).toBeLessThanOrEqual(
      512 - embedder.maxInputTokens,
    );
  });

  it('keeps ONNX Runtime out of the process that asks for embeddings', async () => {
    await localEmbedder(MODEL_CACHE_DIR).embed(['dans un autre processus'], 'passage');
    const report: unknown = process.report.getReport();
    expect(JSON.stringify(report)).not.toMatch(/onnxruntime/i);
  });

  it('needs no network once the model files are in the cache directory', async () => {
    const offline = localEmbedder(MODEL_CACHE_DIR, loadOffline);
    const [embedding] = await offline.embed(['hors ligne'], 'passage');
    expect(embedding).toHaveLength(384);
    expect(await offline.countTokens(['hors ligne'])).toHaveLength(1);

    // The same refusal on an empty cache proves that the preload really cuts the network.
    const emptyCache = mkdtempSync(join(tmpdir(), 'liasse-empty-model-cache-'));
    try {
      await expect(
        localEmbedder(emptyCache, loadOffline).embed(['hors ligne'], 'passage'),
      ).rejects.toThrow();
    } finally {
      rmSync(emptyCache, { recursive: true, force: true });
    }
  });
});
