import type { EntityMatchRule } from '../domain/enums.ts';
import type { EntityProvenance } from '../domain/provenance.ts';
import type { Entity, EntityNames, SimilarEntity } from './entity-store.ts';
import { type ExactMatch, identifiersFor, withAliases } from './exact-match.ts';
import { mergeIdentifiers } from './identifiers.ts';
import type { PreparedMention } from './mention.ts';

// The provenance entry of the entity-typed value the mention was read from.
export type EntityResolution = EntityProvenance;

// Normalization drops the legal form, so an equal name is not quite an identity.
const EXACT_CONFIDENCE: Readonly<Record<ExactMatch['match'], number>> = {
  identifier: 1,
  name: 0.99,
  alias: 0.99,
};

export interface Attachment {
  readonly entity: Entity;
  readonly match: EntityMatchRule;
  readonly confidence: number;
  // Names the entity is now known under as well.
  readonly aliases: readonly string[];
}

export const exactAttachment = ({ entity, match }: ExactMatch): Attachment => ({
  entity,
  match,
  confidence: EXACT_CONFIDENCE[match],
  aliases: [],
});

export const similarAttachment = (
  { entity, similarity }: SimilarEntity,
  match: 'similarity' | 'arbitration',
  aliases: readonly string[],
): Attachment => ({ entity, match, confidence: Math.min(1, similarity), aliases });

// What the entity gains from this mention: the identifiers it may take and did not have,
// and the aliases the rule adds. Nothing when the mention brings nothing new.
export const enrichment = (
  { entity, aliases }: Attachment,
  mention: PreparedMention,
  everyEntity: readonly Entity[],
): EntityNames | undefined => {
  const names = {
    aliases: withAliases(entity, aliases),
    identifiers: mergeIdentifiers(
      entity.identifiers,
      identifiersFor(entity, everyEntity, mention.identifiers),
    ),
  };
  const unchanged =
    names.aliases.length === entity.aliases.length &&
    names.identifiers.length === entity.identifiers.length;
  return unchanged ? undefined : names;
};

export const toResolution = ({ entity, match, confidence }: Attachment): EntityResolution => ({
  entity_id: entity.id,
  match,
  confidence,
});
