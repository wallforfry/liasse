import { MAX_QUERY_ENTITY_NAME_LENGTH, MAX_QUERY_ENTITY_NAMES } from '@liasse/contract/domain';
import type { QueryError } from '@liasse/contract/query';
import { ok, type Result } from '@liasse/contract/registry';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../db/client.ts';
import { entities } from '../db/schema/registry.ts';
import { entityNameKey } from '../domain/entity-name.ts';
import { textParameters } from './access.ts';
import { executeStatement } from './execute.ts';

export interface KnownEntity {
  readonly id: string;
  readonly name: string;
  // The key of the canonical name and of each alias: what two names must share to name
  // the same entity.
  readonly keys: readonly string[];
}

export interface EntityReading {
  readonly db: Database;
  readonly timeoutMilliseconds: number;
  // The most entities a query reads to match a name.
  readonly maxEntities: number;
}

type Read<Value> = Promise<Result<Value, readonly QueryError[]>>;

const idRows = z.array(z.object({ id: z.string() }));

// The references that are ids of entities. One lookup on the primary key: comparing an
// entity by its id never reads the others.
export const existingEntityIds = async (
  references: readonly string[],
  { db, timeoutMilliseconds }: EntityReading,
): Read<ReadonlySet<string>> => {
  const stored = await executeStatement(
    db,
    sql`SELECT ${entities.id} AS "id" FROM ${entities}
      WHERE ${entities.id} IN (${textParameters(references)})`,
    timeoutMilliseconds,
  );
  return stored.ok ? ok(new Set(idRows.parse(stored.value).map(({ id }) => id))) : stored;
};

const entityRows = z.array(
  z.object({ id: z.string(), name: z.string(), aliases: z.array(z.string()) }),
);

// The key a query compares names by: the key of entity names, over the start of the name.
// Two names that only differ past that length are the same name to a query.
export const queryNameKey = (name: string): string =>
  entityNameKey(name.slice(0, MAX_QUERY_ENTITY_NAME_LENGTH));

// Two names are the same entity when `entityNameKey` says so, and that exists in
// TypeScript only: entity resolution compares names there too, and the table stores no
// key to compare in SQL. So names are matched in memory, over a read that is bounded in
// every direction: a number of entities, a number of names for each (the canonical name,
// then its first aliases) and a length for each name. One entity more than the limit is
// asked for, which is how the caller sees that the table holds more than a query reads.
export const readEntities = async ({
  db,
  timeoutMilliseconds,
  maxEntities,
}: EntityReading): Read<readonly KnownEntity[]> => {
  const stored = await executeStatement(
    db,
    sql`SELECT ${entities.id} AS "id", ${entities.canonicalName} AS "name",
        ${entities.aliases}[1:${MAX_QUERY_ENTITY_NAMES - 1}] AS "aliases"
      FROM ${entities} ORDER BY ${entities.id} LIMIT ${maxEntities + 1}`,
    timeoutMilliseconds,
  );
  if (!stored.ok) return stored;
  return ok(
    entityRows
      .parse(stored.value)
      .map(({ id, name, aliases }) => ({ id, name, keys: [name, ...aliases].map(queryNameKey) })),
  );
};

// The ids of the entities that bear each key. Filled in place: one pass over the entities.
export const idsByKey = (known: readonly KnownEntity[]): ReadonlyMap<string, readonly string[]> => {
  const index = new Map<string, string[]>();
  for (const { id, keys } of known) {
    for (const key of new Set(keys)) {
      const ids = index.get(key);
      if (ids === undefined) index.set(key, [id]);
      else ids.push(id);
    }
  }
  return index;
};
