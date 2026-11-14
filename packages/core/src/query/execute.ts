import { DrizzleQueryError, type SQL, sql } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { sqlStateOf } from '../db/sql-state.ts';
import { err, ok, type Result } from '../registry/result.ts';
import { failure, type QueryError } from './errors.ts';

export type StoredRow = Readonly<Record<string, unknown>>;

// SQLSTATE `query_canceled`, which is what a statement timeout raises.
const QUERY_CANCELED = '57014';

const isDatabaseFailure = (error: unknown): boolean =>
  error instanceof DrizzleQueryError || sqlStateOf(error) !== undefined;

// A failure of the database while a query runs. The error Drizzle throws quotes the
// statement and its parameters in its message, and the driver error may quote a stored
// value: neither is kept, not even as a cause. Only the SQLSTATE is.
export class QueryExecutionError extends Error {
  override readonly name = 'QueryExecutionError';
  readonly sqlState: string | undefined;

  constructor(sqlState: string | undefined) {
    super(`The query could not be run${sqlState === undefined ? '' : ` (SQLSTATE ${sqlState})`}.`);
    this.sqlState = sqlState;
  }
}

// Runs the database work of a query so that nothing it throws carries a statement.
export const withoutStatement = async <Outcome>(work: () => Promise<Outcome>): Promise<Outcome> => {
  try {
    return await work();
  } catch (error) {
    if (!isDatabaseFailure(error)) throw error;
    throw new QueryExecutionError(sqlStateOf(error));
  }
};

// The timeout is local to a read-only transaction: it never outlives the query on a
// pooled connection, and a statement that writes is refused by Postgres itself.
export const executeStatement = async (
  db: Database,
  statement: SQL,
  timeoutMilliseconds: number,
): Promise<Result<readonly StoredRow[], readonly QueryError[]>> => {
  try {
    return ok(
      await db.transaction(
        async (tx) => {
          await tx.execute(
            sql`SELECT set_config('statement_timeout', ${String(timeoutMilliseconds)}, true)`,
          );
          return [...(await tx.execute(statement))];
        },
        { accessMode: 'read only' },
      ),
    );
  } catch (error) {
    if (sqlStateOf(error) !== QUERY_CANCELED) throw error;
    return err([
      failure(
        'timeout',
        [],
        `The query ran for more than ${String(timeoutMilliseconds)} ms and was stopped. Narrow it with more conditions or a type.`,
      ),
    ]);
  }
};
