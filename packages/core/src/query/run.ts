import { DEFAULT_QUERY_TIMEOUT_MILLISECONDS, MAX_QUERY_ENTITIES } from '@liasse/contract/domain';
import {
  cappedErrors,
  cappedWarnings,
  failure,
  parseQueryDsl,
  type QueryError,
  quoted,
} from '@liasse/contract/query';
import { err, ok, type Result } from '@liasse/contract/registry';
import type { Database } from '../db/client.ts';
import { resolveType } from '../registry/read-types.ts';
import { checkQuery } from './check.ts';
import { compileQuery } from './compile.ts';
import { resolveEntities } from './entities.ts';
import { executeStatement, withoutStatement } from './execute.ts';
import { queryFields } from './fields.ts';
import { type QueryResult, toQueryResult } from './result.ts';

export interface QueryContext {
  readonly db: Database;
  // Upper bound for each statement of the query, lock waits included.
  readonly timeoutMilliseconds?: number;
  // The most entities read to match a name; a name is refused when more exist.
  readonly maxEntities?: number;
}

type Outcome = Result<QueryResult, readonly QueryError[]>;

const answer = async (
  input: unknown,
  { db, timeoutMilliseconds, maxEntities }: Required<QueryContext>,
): Promise<Outcome> => {
  const dsl = parseQueryDsl(input);
  if (!dsl.ok) return dsl;
  const { type: typeName } = dsl.value;
  const type = typeName === undefined ? undefined : await resolveType(typeName, { db });
  if (typeName !== undefined && type === undefined) {
    return err([
      failure(
        'unknown_type',
        ['type'],
        `No type has the slug or the alias ${quoted(typeName)}. Leave "type" out to query every document on its core fields.`,
      ),
    ]);
  }
  const checked = checkQuery(dsl.value, queryFields(type));
  if (!checked.ok) return checked;
  const entities = await resolveEntities(checked.value.conditions, {
    db,
    timeoutMilliseconds,
    maxEntities,
    includePrivate: checked.value.includePrivate,
  });
  if (!entities.ok) return entities;
  const statement = compileQuery(checked.value, {
    entityIds: entities.value.entityIds,
    ...(type === undefined ? {} : { typeId: type.id }),
  });
  const stored = await executeStatement(db, statement, timeoutMilliseconds);
  return stored.ok
    ? ok(toQueryResult(checked.value, stored.value, entities.value.warnings))
    : stored;
};

// Runs a query written in the DSL. The input is untrusted: it is parsed, every path is
// resolved against the registry, and only then compiled. A failure is a list of errors
// an agent can act on. Errors and warnings are both cut at a fixed number, the last
// entry then counting the ones left out. A failure of the database is thrown as a
// `QueryExecutionError`, which carries no statement.
//
// Known disclosure, for whoever exposes this to an agent: comparing an entity by a name
// answers without an `unknown_entity` warning as soon as an entity bears that name, even
// when only private documents refer to it and `include_private` is false. The documents
// stay hidden and the name is never suggested, but the absence of the warning says the
// entity exists.
export const runQuery = async (
  input: unknown,
  {
    db,
    timeoutMilliseconds = DEFAULT_QUERY_TIMEOUT_MILLISECONDS,
    maxEntities = MAX_QUERY_ENTITIES,
  }: QueryContext,
): Promise<Outcome> => {
  const outcome = await withoutStatement(() =>
    answer(input, { db, timeoutMilliseconds, maxEntities }),
  );
  return outcome.ok
    ? ok({ ...outcome.value, warnings: cappedWarnings(outcome.value.warnings) })
    : err(cappedErrors(outcome.error));
};
