import type { Config } from '../../config/schema.ts';
import { EmbeddingDimensionError } from '../errors.ts';
import type { Embedder, Embedding, EmbeddingKind } from '../ports.ts';
import { toModelError } from './failure.ts';
import { MAX_RETRIES } from './language-call.ts';
import { loadSdk, once } from './lazy.ts';
import { isLocalEndpoint } from './locality.ts';
import { PROVIDERS } from './registry.ts';

export type RemoteEmbeddingConfig = Exclude<Config['embedding'], { readonly provider: 'local' }>;

// The SDK already splits a call at the provider's own limit of inputs per request (32 for
// Mistral, 100 for Gemini, 2048 for OpenAI). This lower bound also keeps a request of
// 800-token chunks under OpenAI's limit of 300,000 tokens per request, and gives each
// request of a slow local server its own timeout.
export const MAX_TEXTS_PER_REQUEST = 64;

const batchesOf = (texts: readonly string[]): readonly (readonly string[])[] =>
  Array.from({ length: Math.ceil(texts.length / MAX_TEXTS_PER_REQUEST) }, (_, index) =>
    texts.slice(index * MAX_TEXTS_PER_REQUEST, (index + 1) * MAX_TEXTS_PER_REQUEST),
  );

export const createProviderEmbedder = (config: RemoteEmbeddingConfig): Embedder => {
  const { provider, model, dimension, timeoutMs } = config;
  const adapter = PROVIDERS[provider];
  const context = { provider, model };
  const loadModel = once(() => adapter.embeddingModel(config, model));

  const embedBatch = async (
    texts: readonly string[],
    kind: EmbeddingKind,
  ): Promise<readonly Embedding[]> => {
    const sdk = await loadSdk();
    const { embeddings } = await sdk
      .embedMany({
        model: await loadModel(),
        values: [...texts],
        maxRetries: MAX_RETRIES,
        maxParallelCalls: 1,
        abortSignal: AbortSignal.timeout(timeoutMs),
        ...(adapter.requestsDimension ? { dimensions: dimension } : {}),
        ...(adapter.taskOptions === undefined
          ? {}
          : { providerOptions: adapter.taskOptions(kind) }),
      })
      .catch((error: unknown) => {
        throw toModelError(sdk, error, context);
      });
    const mismatch = embeddings.find((embedding) => embedding.length !== dimension);
    if (mismatch !== undefined) {
      throw new EmbeddingDimensionError(model, dimension, mismatch.length);
    }
    return embeddings;
  };

  return {
    dimension,
    model,
    isLocal: isLocalEndpoint(provider, config.baseUrl),
    embed: async (texts, kind) => {
      const embeddings: Embedding[] = [];
      for (const batch of batchesOf(texts)) embeddings.push(...(await embedBatch(batch, kind)));
      return embeddings;
    },
  };
};
