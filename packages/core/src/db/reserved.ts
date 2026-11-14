import { drizzle } from 'drizzle-orm/postgres-js';
import type { Sql } from 'postgres';
import type { Database } from './client.ts';
import * as schema from './schema/index.ts';

// postgres.js types a reserved connection apart from a client, and builds it without
// the `options` of its pool. The Drizzle driver reads `options` (the type parsers of the
// pool, which Drizzle already set) and sends every query through `unsafe`; it calls
// `begin` only for a transaction, which a reserved connection cannot open.
const isDrizzleClient = (connection: object): connection is Sql =>
  'unsafe' in connection && 'options' in connection;

/**
 * Runs `run` on one connection of the pool, kept for it alone until it settles: every
 * statement `run` makes through the handle it is given goes to that connection, so it
 * never waits for a second one, and session state (an advisory lock) stays with it.
 * A connection that breaks meanwhile stays broken: every later statement on the handle
 * fails, none is sent to another backend. The handle cannot open a transaction.
 */
export const withReservedConnection = async <Result>(
  db: Database,
  run: (connection: Database) => Promise<Result>,
): Promise<Result> => {
  const reserved = await db.$client.reserve();
  try {
    const client = Object.assign(reserved, { options: db.$client.options });
    if (!isDrizzleClient(client)) throw new Error('A reserved connection lacks `unsafe`');
    return await run(drizzle(client, { schema }));
  } finally {
    reserved.release();
  }
};
