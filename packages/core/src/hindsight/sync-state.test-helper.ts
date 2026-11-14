import { eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { documents } from '../db/schema/documents.ts';

/** As if the longest a retain of the document can stay in flight had passed. */
export const outlastRetains = async (db: Database, documentId: string): Promise<void> => {
  await db
    .update(documents)
    .set({ hindsightRetainUntil: sql`now() - interval '1 second'` })
    .where(eq(documents.id, documentId));
};
