import type { EmbeddingSettings } from '../settings/resolve.ts';
import { CHUNK_MAX_TOKENS } from '../search/chunking.ts';

// One line for the operator once the settings apply. A remote provider does not tell what its
// model reads, so without `max_input_tokens` in the embedding settings the chunks keep the size of the spec, which a model
// with a smaller window truncates silently.
export const describeEmbeddingWindow = (config: EmbeddingSettings): string | undefined =>
  config.provider === 'local' || config.maxInputTokens !== undefined
    ? undefined
    : 'Notice: the embedding settings set no max_input_tokens, so chunks are sized for an ' +
      `embedding model that reads at least ${String(CHUNK_MAX_TOKENS)} tokens. If ` +
      `${config.model} reads fewer, the end of each chunk is left out of its embedding ` +
      'without an error: set max_input_tokens to the input window of the model.';
