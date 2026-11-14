import { asc, eq } from 'drizzle-orm';
import { documentPages } from '../db/schema/documents.ts';
import type { Reader } from './document.ts';
import type { PageText } from './token-budget.ts';

export const loadPages = (reader: Reader, documentId: string): Promise<readonly PageText[]> =>
  reader
    .select({ page: documentPages.page, text: documentPages.text })
    .from(documentPages)
    .where(eq(documentPages.documentId, documentId))
    .orderBy(asc(documentPages.page));
