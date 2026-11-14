import { closestTypes, DEFAULT_CLOSEST_TYPES, listTypes } from '../../registry/read-types.ts';
import type { RegisteredType } from '../../registry/type-store.ts';
import type { PipelineDeps } from '../deps.ts';

export interface Candidate {
  readonly type: RegisteredType;
  readonly exampleTitle: string | null;
}

// Without a similarity to rank by, the types that hold the most documents are the
// likeliest; `listTypes` answers in the order of the slugs, which settles a tie.
const mostUsedTypes = async ({ db }: Pick<PipelineDeps, 'db'>): Promise<readonly Candidate[]> =>
  (await listTypes({ includeExamples: true }, { db }))
    .toSorted((left, right) => right.docCount - left.docCount)
    .slice(0, DEFAULT_CLOSEST_TYPES)
    .map(({ examples, docCount: _docCount, ...type }) => ({
      type,
      exampleTitle: examples?.[0] ?? null,
    }));

/**
 * The types offered to the classification call, the best first: the closest to the
 * opening of the document by embedding. The opening of a private document never reaches
 * an embedder outside the installation (spec, Privacy): its candidates are the most used
 * types instead.
 */
export const findCandidates = async (
  { db, embedder }: Pick<PipelineDeps, 'db' | 'embedder'>,
  opening: string,
  isPrivate: boolean,
): Promise<readonly Candidate[]> => {
  if (isPrivate && !embedder.isLocal) return mostUsedTypes({ db });
  const [embedding] = await embedder.embed([opening], 'query');
  if (embedding === undefined) throw new Error('The embedder returned no embedding');
  return closestTypes(embedding, { db });
};
