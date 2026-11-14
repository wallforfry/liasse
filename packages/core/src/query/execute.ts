import { type SQL, sql } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { err, ok, type Result } from '../registry/result.ts';
import { failure, type QueryError } from './errors.ts';

export type StoredRow = Readonly<Record<string, unknown>>;

// SQLSTATE `query_canceled`, which is what a statement timeout raises.
const QUERY_CANCELED = '57014';

// The driver error is wrapped by Drizzle, whose own message quotes the statement.
const isCanceled = (error: unknown): boolean =>
  error instanceof Error &&
  (('code' in error && error.code === QUERY_CANCELED) || isCanceled(error.cause));

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
    if (!isCanceled(error)) throw error;
    return err([
      failure(
        'timeout',
        [],
        `The query ran for more than ${String(timeoutMilliseconds)} ms and was stopped. Narrow it with more conditions or a type.`,
      ),
    ]);
  }
};
