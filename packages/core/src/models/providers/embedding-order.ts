import { z } from 'zod';
import type { Embedding } from '../ports.ts';

// The OpenAI embeddings format, which Mistral, Ollama and compatible servers share: each
// item says which input it embeds. The SDK returns the items in the order received.
const indexedResponse = z.object({
  body: z.object({ data: z.array(z.object({ index: z.number().int().nonnegative() })) }),
});

// For each returned embedding, the position of its text in the request; `undefined` when a
// response carries no index (Gemini), in which case the order received is the only one known.
const requestPositions = (responses: readonly unknown[]): readonly number[] | undefined => {
  const parsed = responses.map((response) => indexedResponse.safeParse(response));
  return parsed.reduce<readonly number[] | undefined>(
    (positions, result) =>
      positions === undefined || !result.success
        ? undefined
        : [...positions, ...result.data.body.data.map(({ index }) => positions.length + index)],
    [],
  );
};

// The embeddings in the order of the texts, or `undefined` when the indexes of the
// responses do not name each text exactly once.
export const inRequestOrder = (
  embeddings: readonly Embedding[],
  responses: readonly unknown[],
): readonly Embedding[] | undefined => {
  const positions = requestPositions(responses);
  if (positions === undefined || responses.length === 0) return embeddings;
  const ordered = embeddings.flatMap((_, target) => {
    const source = embeddings[positions.indexOf(target)];
    return source === undefined ? [] : [source];
  });
  return positions.length === embeddings.length && ordered.length === embeddings.length
    ? ordered
    : undefined;
};
