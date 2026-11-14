import { z } from 'zod';
import { entityNameKey, normalizeEntityName } from '../domain/entity-name.ts';
import { MAX_ENTITY_NAME_LENGTH } from '../domain/limits.ts';
import { entityKindSchema } from '../domain/schemas.ts';
import type { EntitiesReadContext } from './context.ts';
import { type Entity, findEntityById, loadEntities } from './entity-store.ts';
import { type IdentifierView, viewIdentifier } from './identifiers.ts';
import { countDocumentsByEntity, type DocumentCountOptions } from './references.ts';

export const DEFAULT_ENTITY_LIST_LIMIT = 50;
export const MAX_ENTITY_LIST_LIMIT = 200;

export const listEntitiesOptionsSchema = z.strictObject({
  // Words of a name, in any order, each one possibly cut short: "synth ener".
  query: z.string().trim().min(1).max(MAX_ENTITY_NAME_LENGTH).optional(),
  kind: entityKindSchema.optional(),
  limit: z.int().min(1).max(MAX_ENTITY_LIST_LIMIT).default(DEFAULT_ENTITY_LIST_LIMIT),
  offset: z.int().min(0).default(0),
  // Whether the document counts include the documents flagged `private`.
  includePrivate: z.boolean().default(false),
});
export type ListEntitiesOptions = z.input<typeof listEntitiesOptionsSchema>;

export interface ListedEntity extends Omit<Entity, 'identifiers'> {
  readonly identifiers: readonly IdentifierView[];
  // Documents that name the entity in an entity-typed field, counted on every read.
  readonly documentCount: number;
}

export interface EntityList {
  readonly entities: readonly ListedEntity[];
  // How many entities match, whatever the page.
  readonly total: number;
}

type NameTest = (name: string) => boolean;

// The query goes through the same normalizer as the names: case, accents and legal form
// are ignored on both sides. Every word of the query must start a word of one name. A
// query without any letter or digit has no word, and finds nothing.
const nameTest = (query: string): NameTest => {
  const words = normalizeEntityName(query);
  if (words.length === 0) return () => false;
  return (name) => {
    const tokens = normalizeEntityName(name);
    return words.every((word) => tokens.some((token) => token.startsWith(word)));
  };
};

const namesOf = ({ canonicalName, aliases }: Entity): readonly string[] => [
  canonicalName,
  ...aliases,
];

const compareText = (left: string, right: string): number =>
  left === right ? 0 : left < right ? -1 : 1;

const byName = (left: Entity, right: Entity): number =>
  compareText(entityNameKey(left.canonicalName), entityNameKey(right.canonicalName)) ||
  compareText(left.id, right.id);

// An entity that goes by exactly the name asked for comes before those that contain it.
const ranked = (entities: readonly Entity[], query: string | undefined): readonly Entity[] => {
  if (query === undefined) return entities.toSorted(byName);
  const matches = nameTest(query);
  const queryKey = entityNameKey(query);
  const isExact = (entity: Entity): boolean =>
    namesOf(entity).some((name) => entityNameKey(name) === queryKey);
  return entities
    .filter((entity) => namesOf(entity).some(matches))
    .toSorted(
      (left, right) => Number(isExact(right)) - Number(isExact(left)) || byName(left, right),
    );
};

const toListed = (entity: Entity, documentCount: number): ListedEntity => ({
  ...entity,
  identifiers: entity.identifiers.map(viewIdentifier),
  documentCount,
});

// The names are matched here rather than in SQL: the normalizer stays the only place
// that says when two names are alike, and an installation holds few entities.
export const listEntities = async (
  { db }: EntitiesReadContext,
  options: ListEntitiesOptions = {},
): Promise<EntityList> => {
  const { query, kind, limit, offset, includePrivate } = listEntitiesOptionsSchema.parse(options);
  const matching = ranked(await loadEntities(db, kind), query);
  const page = matching.slice(offset, offset + limit);
  const counts = await countDocumentsByEntity(
    db,
    page.map(({ id }) => id),
    { includePrivate },
  );
  return {
    entities: page.map((entity) => toListed(entity, counts.get(entity.id) ?? 0)),
    total: matching.length,
  };
};

export const getEntity = async (
  { db }: EntitiesReadContext,
  id: string,
  options: DocumentCountOptions = {},
): Promise<ListedEntity | undefined> => {
  const entity = await findEntityById(db, id);
  if (entity === undefined) return undefined;
  const counts = await countDocumentsByEntity(db, [id], options);
  return toListed(entity, counts.get(id) ?? 0);
};
