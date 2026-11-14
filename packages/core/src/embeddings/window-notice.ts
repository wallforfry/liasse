import type { Config } from '../config/schema.ts';
import { CHUNK_MAX_TOKENS } from '../search/chunking.ts';

// One line for the operator at startup. A remote provider does not tell what its model reads,
// so without EMBEDDING_MAX_INPUT_TOKENS the chunks keep the size of the spec, which a model
// with a smaller window truncates silently.
export const describeEmbeddingWindow = (config: Config['embedding']): string | undefined =>
  config.provider === 'local' || config.maxInputTokens !== undefined
    ? undefined
    : 'Notice: EMBEDDING_MAX_INPUT_TOKENS is not set, so chunks are sized for an embedding ' +
      `model that reads at least ${String(CHUNK_MAX_TOKENS)} tokens. If ${config.model} reads ` +
      'fewer, the end of each chunk is left out of its embedding without an error: set ' +
      'EMBEDDING_MAX_INPUT_TOKENS to the input window of the model.';
