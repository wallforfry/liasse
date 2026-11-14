import { z } from 'zod';
import { entityNameKey } from '../domain/entity-name.ts';
import type { EntityKind } from '../domain/enums.ts';
import {
  MAX_ENTITY_CONTEXT_LENGTH,
  MAX_ENTITY_NAME_LENGTH,
  MAX_IDENTIFIERS_PER_MENTION,
} from '../domain/limits.ts';
import { entityKindSchema } from '../domain/schemas.ts';
import { redactSensitiveIdentifiers } from './detect-sensitive.ts';
import {
  mentionIdentifierSchema,
  mergeIdentifiers,
  type StoredIdentifier,
  storeIdentifier,
} from './identifiers.ts';
import type { IdentifierKey } from './sensitive.ts';

// What extraction produces for an entity-typed value. Everything in it was read in a
// document: it is data, and is validated here before anything is done with it.
export const entityMentionSchema = z.strictObject({
  name: z.string().trim().min(1).max(MAX_ENTITY_NAME_LENGTH),
  // Without a kind the mention may attach to an entity of any kind.
  kind: entityKindSchema.optional(),
  identifiers: z.array(mentionIdentifierSchema).max(MAX_IDENTIFIERS_PER_MENTION).optional(),
  // A few words that tell this entity from its namesakes: an activity, a city, a role.
  context: z.string().trim().max(MAX_ENTITY_CONTEXT_LENGTH).optional(),
});
export type EntityMention = z.input<typeof entityMentionSchema>;

export class InvalidEntityMentionError extends Error {
  override readonly name: string = 'InvalidEntityMentionError';
}

export interface PreparedMention {
  readonly name: string;
  readonly nameKey: string;
  readonly kind: EntityKind | undefined;
  // Normalized, sensitive ones masked: the clear values do not go further than this.
  readonly identifiers: readonly StoredIdentifier[];
  readonly context: string | undefined;
}

export const prepareMention = (key: IdentifierKey, mention: EntityMention): PreparedMention => {
  const parsed = entityMentionSchema.safeParse(mention);
  if (!parsed.success) {
    // Zod's issues name the paths and the rules, never the rejected values.
    throw new InvalidEntityMentionError(z.prettifyError(parsed.error));
  }
  const { kind, identifiers = [], context } = parsed.data;
  // An IBAN or a card number written in the name or the context would otherwise be
  // stored as a name, embedded and shown to the text model.
  const name = redactSensitiveIdentifiers(parsed.data.name);
  return {
    name,
    nameKey: entityNameKey(name),
    kind,
    identifiers: mergeIdentifiers(
      [],
      identifiers.flatMap((identifier) => storeIdentifier(key, identifier)),
    ),
    context:
      context === undefined || context === '' ? undefined : redactSensitiveIdentifiers(context),
  };
};
