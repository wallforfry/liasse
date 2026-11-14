import { describe, expect, it, vi } from 'vitest';
import { StartupError } from '../domain/errors.ts';
import {
  EmbeddingModelDimensionError,
  EmbeddingOutputError,
  LocalModelProcessError,
} from './errors.ts';
import type { ScheduleTimer } from './idle-resource.ts';
import {
  createLocalEmbedder,
  DEFAULT_LOCAL_EMBEDDING_MODEL,
  LOCAL_EMBEDDER_IDLE_MS,
  type LocalEmbedderOptions,
} from './local.ts';
import type { LocalModelSpec } from './local-model.ts';

const STUB_MODEL = 'synthetic/e5-stub';

type Vectorise = (text: string) => readonly number[];

// The text length on the first axis keeps vectors distinguishable; [3, 4] has norm 5.
const byLength: Vectorise = (text) => [text.length * 3, text.length * 4];

const setup = (options: Partial<LocalEmbedderOptions> = {}, vectorise: Vectorise = byLength) => {
  const specs: LocalModelSpec[] = [];
  const batches: (readonly string[])[] = [];
  const idleCallbacks: (() => void)[] = [];
  const idleDelays: number[] = [];
  const disposed: number[] = [];
  const schedule: ScheduleTimer = (callback, delayMs) => {
    idleCallbacks.push(callback);
    idleDelays.push(delayMs);
    return () => undefined;
  };
  const embedder = createLocalEmbedder({
    dimension: 2,
    cacheDir: '/synthetic/models',
    model: STUB_MODEL,
    schedule,
    loadModel: (spec) => {
      specs.push(spec);
      const instance = specs.length;
      return Promise.resolve({
        embed: (texts) => {
          batches.push(texts);
          return Promise.resolve(texts.map(vectorise));
        },
        countTokens: (texts) => Promise.resolve(texts.map((text) => text.split(' ').length)),
        dispose: () => {
          disposed.push(instance);
          return Promise.resolve();
        },
      });
    },
    ...options,
  });
  return { embedder, specs, batches, idleCallbacks, idleDelays, disposed };
};

describe('createLocalEmbedder', () => {
  it('describes a local embedder of the configured dimension', () => {
    const { embedder } = setup();
    expect(embedder).toMatchObject({ dimension: 2, model: STUB_MODEL, isLocal: true });
  });

  it('loads the model on the first embedding only, from the configured cache directory', async () => {
    const { embedder, specs } = setup();
    expect(specs).toEqual([]);
    expect(await embedder.embed([], 'passage')).toEqual([]);
    expect(specs).toEqual([]);
    await Promise.all([embedder.embed(['a'], 'passage'), embedder.embed(['b'], 'query')]);
    await embedder.embed(['c'], 'passage');
    expect(specs).toEqual([{ model: STUB_MODEL, cacheDir: '/synthetic/models' }]);
  });

  it('defaults to the multilingual e5 model', async () => {
    const { embedder, specs } = setup({ model: undefined, dimension: 384 }, () =>
      Array.from({ length: 384 }, () => 1),
    );
    await embedder.embed(['a'], 'passage');
    expect(embedder.model).toBe(DEFAULT_LOCAL_EMBEDDING_MODEL);
    expect(specs.map((spec) => spec.model)).toEqual(['Xenova/multilingual-e5-small']);
  });

  it('applies the e5 prefix of the embedding kind', async () => {
    const { embedder, batches } = setup();
    await embedder.embed(['facture', 'contrat'], 'passage');
    await embedder.embed(['facture'], 'query');
    expect(batches).toEqual([['passage: facture', 'passage: contrat'], ['query: facture']]);
  });

  it('runs inference in batches of four by default', async () => {
    const { embedder, batches } = setup();
    await embedder.embed(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'], 'passage');
    expect(batches.map((batch) => batch.length)).toEqual([4, 4, 1]);
  });

  it('tells how many tokens of a text the model reads, its own prefix taken off', () => {
    expect(setup().embedder.maxInputTokens).toBe(504);
  });

  it('counts tokens with the model tokenizer, without the e5 prefix', async () => {
    const { embedder, specs, batches } = setup();
    expect(await embedder.countTokens([])).toEqual([]);
    expect(specs).toEqual([]);
    expect(await embedder.countTokens(['un deux trois', 'un'])).toEqual([3, 1]);
    expect(specs).toHaveLength(1);
    expect(batches).toEqual([]);
  });

  it('starts a new model after the model process died', async () => {
    let loads = 0;
    const { embedder } = setup({
      loadModel: () => {
        loads += 1;
        const alive = loads > 1;
        return Promise.resolve({
          embed: (texts) =>
            alive
              ? Promise.resolve(texts.map(byLength))
              : Promise.reject(new LocalModelProcessError('synthetic death')),
          countTokens: () => Promise.resolve([]),
          dispose: () => Promise.resolve(),
        });
      },
    });
    await expect(embedder.embed(['a'], 'passage')).rejects.toBeInstanceOf(LocalModelProcessError);
    expect(await embedder.embed(['a'], 'passage')).toHaveLength(1);
    expect(loads).toBe(2);
  });

  it('runs inference in batches and keeps the order of the texts', async () => {
    const { embedder, batches } = setup({ batchSize: 2 });
    const texts = ['a', 'bb', 'ccc', 'dddd', 'eeeee'];
    const embeddings = await embedder.embed(texts, 'passage');
    expect(batches.map((batch) => batch.length)).toEqual([2, 2, 1]);
    expect(batches.flat()).toEqual(texts.map((text) => `passage: ${text}`));
    expect(embeddings).toHaveLength(5);
  });

  it('returns L2-normalised vectors', async () => {
    const { embedder } = setup();
    const [embedding] = await embedder.embed(['a'], 'passage');
    expect(embedding?.[0]).toBeCloseTo(0.6, 12);
    expect(embedding?.[1]).toBeCloseTo(0.8, 12);
  });

  it('unloads the model after ten minutes of inactivity and reloads it on demand', async () => {
    const { embedder, specs, idleCallbacks, idleDelays, disposed } = setup();
    await embedder.embed(['a'], 'passage');
    expect(LOCAL_EMBEDDER_IDLE_MS).toBe(600_000);
    expect(idleDelays).toEqual([600_000]);
    idleCallbacks[0]?.();
    await vi.waitFor(() => {
      expect(disposed).toEqual([1]);
    });
    await embedder.embed(['b'], 'passage');
    expect(specs).toHaveLength(2);
    expect(disposed).toEqual([1]);
  });

  it('releases the model on close', async () => {
    const { embedder, disposed } = setup();
    await embedder.embed(['a'], 'passage');
    await embedder.close();
    expect(disposed).toEqual([1]);
  });

  it('refuses at startup a dimension that the known model does not produce', () => {
    const create = () => setup({ model: undefined, dimension: 768 });
    expect(create).toThrow(EmbeddingModelDimensionError);
    expect(create).toThrow(StartupError);
    expect(create).toThrow(
      'The embedding model Xenova/multilingual-e5-small produces vectors of 384 dimensions ' +
        'but EMBEDDING_DIM=768. Set EMBEDDING_DIM=384',
    );
  });

  it('refuses the output of a model whose dimension differs from the configured one', async () => {
    const { embedder } = setup({ dimension: 3 });
    const failure = embedder.embed(['a'], 'passage');
    await expect(failure).rejects.toBeInstanceOf(EmbeddingModelDimensionError);
    await expect(failure).rejects.toMatchObject({ produced: 2, configured: 3 });
  });

  it.each([
    ['a zero vector', (): readonly number[] => [0, 0]],
    ['a non-finite vector', (): readonly number[] => [Number.NaN, 1]],
  ])('refuses %s', async (_, vectorise) => {
    const { embedder } = setup({}, vectorise);
    await expect(embedder.embed(['a'], 'passage')).rejects.toBeInstanceOf(EmbeddingOutputError);
  });

  it('refuses an output that does not hold one vector per text', async () => {
    const { embedder } = setup({
      loadModel: () =>
        Promise.resolve({
          embed: () => Promise.resolve([[3, 4]]),
          countTokens: () => Promise.resolve([]),
          dispose: () => Promise.resolve(),
        }),
    });
    await expect(embedder.embed(['a', 'b'], 'passage')).rejects.toThrow('1 vectors for 2 texts');
  });
});
