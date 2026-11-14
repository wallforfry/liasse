import { entityNameKey } from '../domain/entity-name.ts';
import type { EntitiesReadContext } from './context.ts';
import { type Entity, loadEntities } from './entity-store.ts';
import { identifierIdentity, isGlobalIdentifier, sharedGlobalIdentifiers } from './identifiers.ts';

export const MERGE_REASONS = ['shared_identifier', 'same_name'] as const;
export type MergeReason = (typeof MERGE_REASONS)[number];

export interface MergeCandidate {
  // The younger entity, to merge into the older one.
  readonly sourceId: string;
  readonly targetId: string;
  readonly reason: MergeReason;
}

const nameKeysOf = ({ canonicalName, aliases }: Entity): readonly string[] =>
  [canonicalName, ...aliases].map(entityNameKey);

export const sharesName = (left: Entity, right: Entity): boolean => {
  const keys = new Set(nameKeysOf(right));
  return nameKeysOf(left).some((key) => keys.has(key));
};

// What makes two entities of one kind candidates: a global identifier, or a name. A
// customer number is not one: two issuers may give the same number.
const relationKeysOf = (entity: Entity): readonly string[] => [
  ...entity.identifiers
    .filter(isGlobalIdentifier)
    .map((identifier) => `${entity.kind}|identifier|${identifierIdentity(identifier)}`),
  ...nameKeysOf(entity).map((key) => `${entity.kind}|name|${key}`),
];

const oldest = (entities: readonly Entity[]): Entity | undefined =>
  entities.toSorted((left, right) => (left.id < right.id ? -1 : 1))[0];

const reasonFor = (entity: Entity, target: Entity): MergeReason =>
  sharedGlobalIdentifiers(entity.identifiers, target.identifiers).length > 0
    ? 'shared_identifier'
    : 'same_name';

// Each entity is paired with the oldest one it is related to, and only with that one: in
// a chain of three, merging the middle one moves the proposal of the youngest onto the
// oldest, and no pair is proposed twice. Takes the entities oldest first.
export const mergeCandidatesAmong = (entities: readonly Entity[]): readonly MergeCandidate[] => {
  // One pass over the entities, each key looked up once: the index is filled as it goes,
  // where a new map per entity made the scan quadratic.
  const oldestByKey = new Map<string, Entity>();
  return entities.flatMap((entity) => {
    const keys = relationKeysOf(entity);
    const target = oldest(keys.flatMap((key) => oldestByKey.get(key) ?? []));
    keys.forEach((key) => {
      if (!oldestByKey.has(key)) oldestByKey.set(key, entity);
    });
    return target === undefined
      ? []
      : [{ sourceId: entity.id, targetId: target.id, reason: reasonFor(entity, target) }];
  });
};

// The pairs of entities that look like one: same kind, and a shared global identifier or
// an equal normalized name. Deterministic: the same entities give the same pairs.
export const findMergeCandidates = async ({
  db,
}: EntitiesReadContext): Promise<readonly MergeCandidate[]> =>
  mergeCandidatesAmong(await loadEntities(db));
