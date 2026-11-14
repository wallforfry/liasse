import type { Database } from '../db/client.ts';
import { DEFAULT_QUERY_TIMEOUT_MILLISECONDS } from '../domain/limits.ts';
import { resolveType } from '../registry/read-types.ts';
import { err, ok, type Result } from '../registry/result.ts';
import { checkQuery } from './check.ts';
import { compileQuery } from './compile.ts';
import { parseQueryDsl } from './dsl.ts';
import { resolveEntities } from './entities.ts';
import { failure, type QueryError, quoted } from './errors.ts';
import { executeStatement } from './execute.ts';
import { queryFields } from './fields.ts';
import { type QueryResult, toQueryResult } from './result.ts';

export interface QueryContext {
  readonly db: Database;
  // Upper bound for the statement, lock waits included.
  readonly timeoutMilliseconds?: number;
}

// Runs a query written in the DSL. The input is untrusted: it is parsed, every path is
// resolved against the registry, and only then compiled. A failure is a list of errors
// an agent can act on; anything else that goes wrong is thrown.
export const runQuery = async (
  input: unknown,
  { db, timeoutMilliseconds = DEFAULT_QUERY_TIMEOUT_MILLISECONDS }: QueryContext,
): Promise<Result<QueryResult, readonly QueryError[]>> => {
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
  const { entityIds, warnings } = await resolveEntities(checked.value.conditions, db);
  const statement = compileQuery(checked.value, {
    entityIds,
    ...(type === undefined ? {} : { typeId: type.id }),
  });
  const stored = await executeStatement(db, statement, timeoutMilliseconds);
  return stored.ok ? ok(toQueryResult(checked.value, stored.value, warnings)) : stored;
};
