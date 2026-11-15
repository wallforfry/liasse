import type { EntityMatchRule } from '@liasse/contract/domain';
import { entityNameKey } from '../domain/entity-name.ts';
import type { Entity } from './entity-store.ts';
import {
  haveConflictingIdentifiers,
  identifierIdentity,
  isAttachingCustomerNumber,
  isGlobalIdentifier,
  type StoredIdentifier,
} from './identifiers.ts';

export interface NamedMention {
  readonly nameKey: string;
  readonly identifiers: readonly StoredIdentifier[];
}

export interface ExactMatch {
  readonly entity: Entity;
  readonly match: Extract<EntityMatchRule, 'identifier' | 'name' | 'alias'>;
}

const carries =
  (identity: string) =>
  ({ identifiers }: Entity): boolean =>
    identifiers.some((identifier) => identifierIdentity(identifier) === identity);

// The entities the global identifiers of a mention designate. One is an answer. Several
// are not: a document prints the numbers of more than one party, and nothing in a mention
// says which of them it is about.
const designatedBy = (
  entities: readonly Entity[],
  identifiers: readonly StoredIdentifier[],
): readonly Entity[] => {
  const identities = identifiers.filter(isGlobalIdentifier).map(identifierIdentity);
  return entities.filter((entity) => identities.some((identity) => carries(identity)(entity)));
};

const byGlobalIdentifier = (
  entities: readonly Entity[],
  identifiers: readonly StoredIdentifier[],
): Entity | undefined => {
  const designated = designatedBy(entities, identifiers);
  return designated.length === 1 ? designated[0] : undefined;
};

// A customer number is scoped to its issuer: it designates an entity only when it is long
// enough and no other entity of the same kind carries it too. Otherwise it says nothing,
// and the name decides.
const byCustomerNumber = (
  entities: readonly Entity[],
  identifiers: readonly StoredIdentifier[],
): Entity | undefined =>
  identifiers
    .filter(isAttachingCustomerNumber)
    .map(identifierIdentity)
    .flatMap((identity) => {
      const carriers = entities.filter(carries(identity));
      return carriers.filter(
        (carrier) => !carriers.some((other) => other !== carrier && other.kind === carrier.kind),
      );
    })[0];

const hasAlias =
  (nameKey: string) =>
  ({ aliases }: Entity): boolean =>
    aliases.some((alias) => entityNameKey(alias) === nameKey);

// An entity that carries another company id or VAT number than the mention is another
// entity, whatever its name: a duplicate can be merged by hand, a wrong fusion cannot be
// undone.
export const mayDesignate =
  ({ identifiers }: NamedMention) =>
  (entity: Entity): boolean =>
    !haveConflictingIdentifiers(entity.identifiers, identifiers);

// The two rules that need no model, in the order of the specification: a strong
// identifier first, then the normalized name against the canonical name and the aliases.
// The entities are compared in the order given, so the first of several matches wins.
export const matchExact = (
  entities: readonly Entity[],
  mention: NamedMention,
): ExactMatch | undefined => {
  const { nameKey, identifiers } = mention;
  const byIdentifier =
    byGlobalIdentifier(entities, identifiers) ?? byCustomerNumber(entities, identifiers);
  if (byIdentifier !== undefined) return { entity: byIdentifier, match: 'identifier' };
  const named = entities.filter(mayDesignate(mention));
  const byName = named.find(({ canonicalName }) => entityNameKey(canonicalName) === nameKey);
  if (byName !== undefined) return { entity: byName, match: 'name' };
  const byAlias = named.find(hasAlias(nameKey));
  return byAlias === undefined ? undefined : { entity: byAlias, match: 'alias' };
};

// The identifiers of a mention an entity may take. Never a global identifier that another
// entity carries, of whatever kind: copying one would make the two look like one entity
// to every later mention and to the merge candidates, on the word of a single document.
// And never a company id or VAT number that differs from the one the entity has, however
// the mention was attached.
export const identifiersFor = (
  entity: Entity | undefined,
  everyEntity: readonly Entity[],
  identifiers: readonly StoredIdentifier[],
): readonly StoredIdentifier[] => {
  const others = everyEntity.filter(({ id }) => id !== entity?.id);
  return identifiers.filter(
    (identifier) =>
      !haveConflictingIdentifiers(entity?.identifiers ?? [], [identifier]) &&
      !(isGlobalIdentifier(identifier) && others.some(carries(identifierIdentity(identifier)))),
  );
};

// The entities a mention ties together without being one of them for sure: those its
// global identifiers designate when they are several, and the one of another kind that
// carries an identifier of the mention. Takes the entities of every kind.
export const bridgedBy = (
  everyEntity: readonly Entity[],
  { identifiers }: NamedMention,
): readonly Entity[] => designatedBy(everyEntity, identifiers);

// The aliases of an entity once it also goes by these names: a name that normalizes like
// the canonical name or like an alias already there adds nothing.
export const withAliases = (
  { canonicalName, aliases }: Pick<Entity, 'canonicalName' | 'aliases'>,
  names: readonly string[],
): readonly string[] =>
  names.reduce<readonly string[]>((known, name) => {
    const nameKey = entityNameKey(name);
    return [canonicalName, ...known].some((other) => entityNameKey(other) === nameKey)
      ? known
      : [...known, name];
  }, aliases);
