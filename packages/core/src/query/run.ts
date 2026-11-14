import type { Database } from '../db/client.ts';
import { DEFAULT_QUERY_TIMEOUT_MILLISECONDS } from '../domain/limits.ts';
import { resolveType } from '../registry/read-types.ts';
import { err, ok, type Result } from '../registry/result.ts';
import { checkQuery } from './check.ts';
import { compileQuery } from './compile.ts';
import { parseQueryDsl } from './dsl.ts';
import { resolveEntities } from './entities.ts';
import { cappedErrors, cappedWarnings, failure, type QueryError, quoted } from './errors.ts';
import { executeStatement, withoutStatement } from './execute.ts';
import { queryFields } from './fields.ts';
import { type QueryResult, toQueryResult } from './result.ts';

export interface QueryContext {
  readonly db: Database;
  // Upper bound for each statement of the query, lock waits included.
  readonly timeoutMilliseconds?: number;
}

type Outcome = Result<QueryResult, readonly QueryError[]>;

const answer = async (
  input: unknown,
  db: Database,
  timeoutMilliseconds: number,
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
export const runQuery = async (
  input: unknown,
  { db, timeoutMilliseconds = DEFAULT_QUERY_TIMEOUT_MILLISECONDS }: QueryContext,
): Promise<Outcome> => {
  const outcome = await withoutStatement(() => answer(input, db, timeoutMilliseconds));
  return outcome.ok
    ? ok({ ...outcome.value, warnings: cappedWarnings(outcome.value.warnings) })
    : err(cappedErrors(outcome.error));
};
