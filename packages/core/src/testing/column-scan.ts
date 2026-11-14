import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../db/client.ts';

const columnsSchema = z.array(z.object({ table_name: z.string(), column_name: z.string() }));
const hitsSchema = z.tuple([z.object({ hits: z.number() })]);

// The columns, as `table.column`, in which a text is found: every column of every table,
// whatever its type, read as text. What a merge must leave no trace of is looked for
// everywhere, so a place that nobody listed is found too.
export const columnsHolding = async (db: Database, needle: string): Promise<readonly string[]> => {
  const columns = columnsSchema.parse(
    await db.execute(sql`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public' ORDER BY table_name, column_name
    `),
  );
  const found = await Promise.all(
    columns.map(async ({ table_name: table, column_name: column }) => {
      const [{ hits }] = hitsSchema.parse(
        await db.execute(sql`
          SELECT count(*)::int AS hits FROM ${sql.identifier(table)}
          WHERE strpos(${sql.identifier(column)}::text, ${needle}) > 0
        `),
      );
      return hits > 0 ? [`${table}.${column}`] : [];
    }),
  );
  return found.flat();
};
