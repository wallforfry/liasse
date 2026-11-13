import { randomBytes } from 'node:crypto';
import type { Database } from '../db/client.ts';
import { documents } from '../db/schema/documents.ts';

export type DocumentRow = typeof documents.$inferSelect;
export type NewDocumentRow = typeof documents.$inferInsert;

export const insertSyntheticDocument = async (
  db: Database,
  overrides: Partial<NewDocumentRow> = {},
): Promise<DocumentRow> => {
  const suffix = randomBytes(8).toString('hex');
  const [document] = await db
    .insert(documents)
    .values({
      sha256: `synthetic-sha256-${suffix}`,
      storageKey: `synthetic/${suffix}`,
      mime: 'application/pdf',
      originalName: `synthetic-${suffix}.pdf`,
      source: 'api',
      ...overrides,
    })
    .returning();
  if (document === undefined) throw new Error('The synthetic document was not inserted');
  return document;
};
