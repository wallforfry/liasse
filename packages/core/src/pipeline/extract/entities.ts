import type { EntityProvenance } from '../../domain/provenance.ts';
import type { EntityMentionInput, EntityResolver, MaskSensitive } from '../deps.ts';
import type { EntityDetail } from './extraction-schema.ts';
import { normalizeForQuote } from './quotes.ts';
import { compactIdentifier } from './support.ts';

export type EntityResolutions = ReadonlyMap<string, EntityProvenance>;

export interface ResolvedMentions {
  readonly resolutions: EntityResolutions;
  /** Identifiers the model gave that were not used: absent from the text, or refused. */
  readonly droppedIdentifiers: number;
}

/** What resolving the mentions of a document needs, bound or injected. */
export interface MentionDeps {
  readonly entities: Pick<EntityResolver, 'resolve'>;
  readonly maskSensitive: MaskSensitive;
}

/** Two spellings of one name in one document are one mention. */
export const mentionKey = (name: string): string => normalizeForQuote(name);

export interface MentionContext {
  /** What the model said of each entity: kind, identifiers, context. */
  readonly details: readonly EntityDetail[];
  /** The text the model was given, to check that an identifier was read and not made up. */
  readonly documentText: string;
  readonly allowExternalEmbedding: boolean;
}

interface Mention {
  readonly input: EntityMentionInput;
  readonly unwritten: number;
}

// A strong identifier attaches a mention to an entity whatever its name: one the
// document does not hold would attach it to the wrong entity, so only those written in
// the text are passed on. The name goes masked, since the resolver keeps it as written.
const toMention = (
  name: string,
  detail: EntityDetail | undefined,
  compactText: string,
  maskSensitive: MaskSensitive,
): Mention => {
  const given = detail?.identifiers ?? [];
  const identifiers = given.filter(({ value }) => {
    const written = compactIdentifier(value);
    return written !== '' && compactText.includes(written);
  });
  const context = detail?.context === undefined ? '' : maskSensitive(detail.context);
  return {
    input: {
      name: maskSensitive(name),
      ...(detail?.kind === undefined ? {} : { kind: detail.kind }),
      ...(identifiers.length === 0 ? {} : { identifiers }),
      ...(context === '' ? {} : { context }),
    },
    unwritten: given.length - identifiers.length,
  };
};

/**
 * Resolves each distinct name once, in the order given. A name the resolver refuses has
 * no entry: the value that carries it is then dropped.
 */
export const resolveMentions = async (
  { entities, maskSensitive }: MentionDeps,
  names: readonly string[],
  { details, documentText, allowExternalEmbedding }: MentionContext,
): Promise<ResolvedMentions> => {
  const detailOf = new Map(details.map((detail) => [mentionKey(detail.name), detail]));
  const compactText = compactIdentifier(documentText);
  const resolutions = new Map<string, EntityProvenance>();
  let droppedIdentifiers = 0;
  for (const key of new Set(names.map(mentionKey))) {
    const name = names.find((candidate) => mentionKey(candidate) === key) ?? key;
    const { input, unwritten } = toMention(name, detailOf.get(key), compactText, maskSensitive);
    const resolved = await entities.resolve(input, { allowExternalEmbedding });
    droppedIdentifiers += unwritten + (resolved?.droppedIdentifiers ?? 0);
    if (resolved !== undefined) resolutions.set(key, resolved.provenance);
  }
  return { resolutions, droppedIdentifiers };
};
