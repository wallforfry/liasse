import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.ts';

export const createDb = (databaseUrl: string) => {
  const client = postgres(databaseUrl, { onnotice: () => undefined });
  return {
    db: drizzle(client, { schema }),
    ping: async (): Promise<void> => {
      await client`SELECT 1`;
    },
    close: async (): Promise<void> => {
      await client.end();
    },
  } as const;
};

export type DatabaseHandle = ReturnType<typeof createDb>;
export type Database = DatabaseHandle['db'];
