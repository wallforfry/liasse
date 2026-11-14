import { z } from 'zod';
import type { QueryError } from '../query/errors.ts';
import { QueryExecutionError } from '../query/execute.ts';
import type { QueryResult } from '../query/result.ts';
import { runQuery } from '../query/run.ts';
import type { ApiContext } from './context.ts';
import { ApiError } from './errors.ts';

const problemSchema = z.looseObject({ code: z.string(), message: z.string() });

// The envelope of a result, for a contract: the rows and groups are described by
// `QueryResult`, and their content depends on the query.
export const queryResultSchema = z.looseObject({
  rows: z.array(z.looseObject({ id: z.string() })).optional(),
  groups: z.array(z.looseObject({})).optional(),
  has_more: z.boolean(),
  warnings: z.array(problemSchema),
});

const TIMEOUT_CODE = 'timeout' satisfies QueryError['code'];

// The errors of the DSL travel as they are, each with its own code, path and data
// fields: they are what lets an agent correct its query.
const refusal = (errors: readonly QueryError[]): ApiError => {
  const timedOut = errors.find(({ code }) => code === TIMEOUT_CODE);
  return timedOut === undefined
    ? new ApiError('invalid', 'invalid_query', 'The query was refused.', { errors })
    : new ApiError('timeout', 'query_timeout', timedOut.message);
};

/**
 * Runs a structured query. The input is untrusted and parsed by the DSL itself.
 * Rejects with `invalid_query` (details: `errors`), `query_timeout`, or `query_failed`
 * when the database could not run it; no statement ever leaves.
 */
export const queryDocuments = async (
  { db, queryTimeoutMs }: Pick<ApiContext, 'db' | 'queryTimeoutMs'>,
  input: unknown,
): Promise<QueryResult> => {
  try {
    const outcome = await runQuery(input, {
      db,
      ...(queryTimeoutMs === undefined ? {} : { timeoutMilliseconds: queryTimeoutMs }),
    });
    if (outcome.ok) return outcome.value;
    throw refusal(outcome.error);
  } catch (error) {
    if (!(error instanceof QueryExecutionError)) throw error;
    throw new ApiError('unavailable', 'query_failed', 'The query could not be run.');
  }
};
