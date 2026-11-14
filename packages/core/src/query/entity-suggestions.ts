import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { documents } from '../db/schema/documents.ts';
import { entityNameKey } from '../domain/entity-name.ts';
import {
  MAX_QUERY_STRING_LENGTH,
  MAX_QUERY_SUGGESTED_ENTITIES,
  MAX_QUERY_SUGGESTION_CANDIDATES,
} from '../domain/limits.ts';
import { PROVENANCE_ENTITY_ID_KEY } from '../domain/provenance.ts';
import { ok, type Result } from '../registry/result.ts';
import { textParameters } from './access.ts';
import { editDistance, isClose, rankByDistance } from './closest.ts';
import { cut, type QueryError } from './errors.ts';
import { executeStatement } from './execute.ts';
import type { EntityReading, KnownEntity } from './entity-index.ts';
import { isLiveDocument } from './source.ts';

const PREFIX_LENGTH = 3;

// More than are suggested: some may be left out for being seen on private documents only.
const SHORTLIST_LENGTH = MAX_QUERY_SUGGESTED_ENTITIES * 4;

const prefixesOf = (key: string): readonly string[] => [
  ...new Set(key.split(' ').map((word) => word.slice(0, PREFIX_LENGTH))),
];

// The entities, by the first letters of each word of their names. Filled in place.
const byPrefix = (known: readonly KnownEntity[]): ReadonlyMap<string, readonly number[]> => {
  const index = new Map<string, number[]>();
  known.forEach(({ keys }, position) => {
    for (const prefix of new Set(keys.flatMap(prefixesOf))) {
      const positions = index.get(prefix);
      if (positions === undefined) index.set(prefix, [position]);
      else positions.push(position);
    }
  });
  return index;
};

const comparable = (key: string): string => key.slice(0, MAX_QUERY_STRING_LENGTH);

// The edit distance is only measured against a fixed number of entities, those that
// share the start of a word with the name: its cost does not grow with the table. A
// name whose typo is in the first letters of every word gets no suggestion.
const shortlist = (
  name: string,
  known: readonly KnownEntity[],
  prefixes: ReadonlyMap<string, readonly number[]>,
): readonly KnownEntity[] => {
  const key = comparable(entityNameKey(name));
  const candidates = [...new Set(prefixesOf(key).flatMap((prefix) => prefixes.get(prefix) ?? []))]
    .slice(0, MAX_QUERY_SUGGESTION_CANDIDATES)
    .flatMap((position) => known[position] ?? []);
  const distanceOf = ({ keys }: KnownEntity): number =>
    Math.min(...keys.map((candidate) => editDistance(key, comparable(candidate))));
  return rankByDistance(candidates, distanceOf)
    .filter(({ distance }) => isClose(distance, key))
    .slice(0, SHORTLIST_LENGTH)
    .map(({ item }) => item);
};

const idRows = z.array(z.object({ id: z.string() }));

// Lax mode steps into the array a list field keeps as its provenance, and skips what is
// not an object: one path reads the entity of every field.
const EVERY_ENTITY_ID = `$.*.${PROVENANCE_ENTITY_ID_KEY}`;

// The entities a document that is neither private nor deleted refers to. A name seen
// only on private documents is itself private: suggesting it would disclose it.
const publicEntityIds = async (
  ids: readonly string[],
  { db, timeoutMilliseconds }: EntityReading,
): Promise<Result<ReadonlySet<string>, readonly QueryError[]>> => {
  if (ids.length === 0) return ok(new Set());
  const stored = await executeStatement(
    db,
    sql`SELECT DISTINCT "reference" #>> '{}' AS "id"
      FROM ${documents},
        jsonb_path_query(${documents.provenance}, ${EVERY_ENTITY_ID}::jsonpath) AS "reference"
      WHERE ${isLiveDocument} AND NOT ${documents.private}
        AND "reference" #>> '{}' IN (${textParameters(ids)})`,
    timeoutMilliseconds,
  );
  return stored.ok ? ok(new Set(idRows.parse(stored.value).map(({ id }) => id))) : stored;
};

export interface SuggestionScope extends EntityReading {
  readonly includePrivate: boolean;
}

// Canonical names of entities close to each name, closest first. They are text extracted
// from documents: cut, and for the caller to carry as data.
export const suggestEntities = async (
  names: readonly string[],
  known: readonly KnownEntity[],
  { includePrivate, ...reading }: SuggestionScope,
): Promise<Result<ReadonlyMap<string, readonly string[]>, readonly QueryError[]>> => {
  if (names.length === 0) return ok(new Map());
  const prefixes = byPrefix(known);
  const shortlists = names.map((name) => [name, shortlist(name, known, prefixes)] as const);
  const shortlisted = [...new Set(shortlists.flatMap(([, close]) => close.map(({ id }) => id)))];
  const visible = includePrivate
    ? ok(new Set(shortlisted))
    : await publicEntityIds(shortlisted, reading);
  if (!visible.ok) return visible;
  return ok(
    new Map(
      shortlists.map(([name, close]) => [
        name,
        close
          .filter(({ id }) => visible.value.has(id))
          .slice(0, MAX_QUERY_SUGGESTED_ENTITIES)
          .map((entity) => cut(entity.name)),
      ]),
    ),
  );
};
