import type { Embedder } from '../models/ports.ts';
import {
  CHUNK_MAX_TOKENS,
  type ChunkContext,
  type ChunkingOptions,
  embeddingInput,
} from './chunking.ts';
import { estimateTokens } from './token-estimate.ts';

// Kept free in the embedder's window: a header and a chunk counted apart can cost a few
// tokens more once joined.
const WINDOW_MARGIN_TOKENS = 16;

// Below this, a window leaves no room for text worth embedding next to the header.
const MIN_CHUNK_TOKENS = 32;

export class EmbedderWindowError extends Error {
  override readonly name = 'EmbedderWindowError';

  constructor(model: string, room: number) {
    super(
      `The embedding model ${model} leaves room for ${String(room)} tokens per chunk, ` +
        `fewer than the ${String(MIN_CHUNK_TOKENS)} a chunk needs`,
    );
  }
}

// A chunk must fit, with its header, in what the embedder reads: anything beyond the window is
// silently left out of the embedding. The spec's 800 tokens is therefore a ceiling, lowered
// to the room an embedder with a smaller window leaves.
export const chunkingFor = async (
  embedder: Embedder,
  context: ChunkContext,
): Promise<ChunkingOptions> => {
  const counter = embedder.countTokens === undefined ? {} : { countTokens: embedder.countTokens };
  if (embedder.maxInputTokens === undefined) return counter;
  const header = embeddingInput('', context);
  const [headerTokens = estimateTokens(header)] = (await embedder.countTokens?.([header])) ?? [];
  const room = embedder.maxInputTokens - headerTokens - WINDOW_MARGIN_TOKENS;
  if (room < MIN_CHUNK_TOKENS) throw new EmbedderWindowError(embedder.model, room);
  return { ...counter, maxTokens: Math.min(CHUNK_MAX_TOKENS, room) };
};
