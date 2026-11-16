import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import type { JsonObject } from '../db/columns.ts';
import { documents, isLiveDocument } from '../db/schema/documents.ts';
import { SETTLED_STATUSES } from '@liasse/contract/domain';

export interface TypeExample {
  readonly title: string | null;
  readonly fields: JsonObject;
  readonly extra: JsonObject;
}

/**
 * The most recent settled documents of a type, for a prompt. A private document never
 * lends its values to one: the model of consolidation reads them, then a person reads
 * the rationale it writes from them.
 */
export const typeExamples = (
  db: Database,
  typeId: string,
  limit: number,
): Promise<readonly TypeExample[]> =>
  db
    .select({ title: documents.title, fields: documents.fields, extra: documents.extra })
    .from(documents)
    .where(
      and(
        eq(documents.typeId, typeId),
        eq(documents.private, false),
        isLiveDocument,
        inArray(documents.status, [...SETTLED_STATUSES]),
      ),
    )
    .orderBy(desc(documents.ingestedAt), desc(documents.id))
    .limit(limit);
