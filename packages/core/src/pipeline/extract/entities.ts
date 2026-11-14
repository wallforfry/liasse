import type { EntityProvenance } from '../../domain/provenance.ts';
import type { EntityMentionInput, PipelineDeps } from '../deps.ts';
import type { EntityDetail } from './extraction-schema.ts';
import { normalizeForQuote } from './quotes.ts';

export type EntityResolutions = ReadonlyMap<string, EntityProvenance>;

/** Two spellings of one name in one document are one mention. */
export const mentionKey = (name: string): string => normalizeForQuote(name);

const compact = (text: string): string => text.toUpperCase().replace(/[^A-Z0-9]/g, '');

export interface MentionContext {
  /** What the model said of each entity: kind, identifiers, context. */
  readonly details: readonly EntityDetail[];
  /** The text the model was given, to check that an identifier was read and not made up. */
  readonly documentText: string;
  readonly allowExternalEmbedding: boolean;
}

// A strong identifier attaches a mention to an entity whatever its name: one the
// document does not hold would attach it to the wrong entity, so only those written in
// the text are passed on. The name goes masked, since the resolver keeps it as written.
const toMention = (
  name: string,
  detail: EntityDetail | undefined,
  compactText: string,
  maskSensitive: PipelineDeps['maskSensitive'],
): EntityMentionInput => {
  const identifiers = (detail?.identifiers ?? []).filter(({ value }) => {
    const written = compact(value);
    return written !== '' && compactText.includes(written);
  });
  const context = detail?.context === undefined ? '' : maskSensitive(detail.context);
  return {
    name: maskSensitive(name),
    ...(detail?.kind === undefined ? {} : { kind: detail.kind }),
    ...(identifiers.length === 0 ? {} : { identifiers }),
    ...(context === '' ? {} : { context }),
  };
};

/**
 * Resolves each distinct name once, in the order given. A name the resolver refuses has
 * no entry: the value that carries it is then dropped.
 */
export const resolveMentions = async (
  { entities, maskSensitive }: Pick<PipelineDeps, 'entities' | 'maskSensitive'>,
  names: readonly string[],
  { details, documentText, allowExternalEmbedding }: MentionContext,
): Promise<EntityResolutions> => {
  const detailOf = new Map(details.map((detail) => [mentionKey(detail.name), detail]));
  const compactText = compact(documentText);
  const resolutions = new Map<string, EntityProvenance>();
  for (const name of names) {
    const key = mentionKey(name);
    if (resolutions.has(key)) continue;
    const resolution = await entities.resolve(
      toMention(name, detailOf.get(key), compactText, maskSensitive),
      { allowExternalEmbedding },
    );
    if (resolution !== undefined) resolutions.set(key, resolution);
  }
  return resolutions;
};
