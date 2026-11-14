import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../db/client.ts';
import { entities } from '../db/schema/registry.ts';
import { entityNameKey } from '../domain/entity-name.ts';
import { MAX_QUERY_ENTITIES } from '../domain/limits.ts';
import { ok, type Result } from '../registry/result.ts';
import { textParameters } from './access.ts';
import type { QueryError } from './errors.ts';
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

// Two names are the same entity when `entityNameKey` says so, and that exists in
// TypeScript only: entity resolution compares names there too, and the table stores no
// key to compare in SQL. So names are matched in memory, over a read that is bounded:
// one entity more than the limit is asked for, which is how the caller sees that the
// table holds more than a query may read.
export const readEntities = async ({
  db,
  timeoutMilliseconds,
}: EntityReading): Read<readonly KnownEntity[]> => {
  const stored = await executeStatement(
    db,
    sql`SELECT ${entities.id} AS "id", ${entities.canonicalName} AS "name",
        ${entities.aliases} AS "aliases"
      FROM ${entities} ORDER BY ${entities.id} LIMIT ${MAX_QUERY_ENTITIES + 1}`,
    timeoutMilliseconds,
  );
  if (!stored.ok) return stored;
  return ok(
    entityRows
      .parse(stored.value)
      .map(({ id, name, aliases }) => ({ id, name, keys: [name, ...aliases].map(entityNameKey) })),
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
