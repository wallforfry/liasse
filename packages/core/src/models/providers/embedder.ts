import type { Config } from '../../config/schema.ts';
import { EmbeddingDimensionError, ModelProviderError } from '../errors.ts';
import type { Embedder, Embedding, EmbeddingKind } from '../ports.ts';
import { inRequestOrder } from './embedding-order.ts';
import { toModelError } from './failure.ts';
import { MAX_RETRIES } from './language-call.ts';
import { loadSdk, once } from './lazy.ts';
import { type HostResolver, isLocalEndpoint } from './locality.ts';
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

export interface ProviderEmbedderOptions {
  // Resolves the host of the endpoint to decide `isLocal`; the system resolver by default.
  readonly resolveHost?: HostResolver;
}

// Asynchronous because `isLocal` is settled here, once, by resolving the endpoint's host.
export const createProviderEmbedder = async (
  config: RemoteEmbeddingConfig,
  { resolveHost }: ProviderEmbedderOptions = {},
): Promise<Embedder> => {
  const { provider, model, dimension, timeoutMs } = config;
  const adapter = PROVIDERS[provider];
  const context = { provider, model };
  const loadModel = once(() => adapter.embeddingModel(config, model));

  const embedBatch = async (
    texts: readonly string[],
    kind: EmbeddingKind,
  ): Promise<readonly Embedding[]> => {
    const sdk = await loadSdk();
    const { embeddings: received, responses } = await sdk
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
    const embeddings = inRequestOrder(received, responses ?? []);
    if (embeddings === undefined) {
      // The reply is complete and wrong: the same request would get the same indexes.
      throw new ModelProviderError({ provider, model, retryable: false, code: 'embedding_index' });
    }
    const mismatch = embeddings.find((embedding) => embedding.length !== dimension);
    if (mismatch !== undefined) {
      throw new EmbeddingDimensionError(model, dimension, mismatch.length);
    }
    return embeddings;
  };

  return {
    dimension,
    model,
    isLocal: await isLocalEndpoint(provider, config.baseUrl, { resolve: resolveHost }),
    // The provider does not tell what its model reads: only the operator can.
    ...(config.maxInputTokens === undefined ? {} : { maxInputTokens: config.maxInputTokens }),
    embed: async (texts, kind) => {
      const embeddings: Embedding[] = [];
      for (const batch of batchesOf(texts)) embeddings.push(...(await embedBatch(batch, kind)));
      return embeddings;
    },
  };
};
