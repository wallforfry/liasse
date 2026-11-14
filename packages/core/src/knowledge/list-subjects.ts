import { count, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { SubjectList } from '../contract/knowledge.ts';
import type { Database } from '../db/client.ts';
import { documents } from '../db/schema/documents.ts';
import {
  DEFAULT_SUBJECT_LIST_LIMIT,
  MAX_SUBJECT_LIST_LIMIT,
  MAX_SUBJECT_NAME_LENGTH,
} from '../domain/limits.ts';
import { subjectKindSchema } from '../domain/schemas.ts';
import type { KnowledgeReadContext } from './context.ts';
import { visibleDocument } from './read-shared.ts';
import { designatedBy, shownTo } from './subject-designation.ts';
import { loadSubjects } from './subject-store.ts';

export const listSubjectsInputSchema = z.strictObject({
  // Words to find subjects by, read as `get_subject` reads them: a label, a plate, an address.
  query: z.string().trim().min(1).max(MAX_SUBJECT_NAME_LENGTH).optional(),
  kind: subjectKindSchema.optional(),
  includePrivate: z.boolean().default(false),
  limit: z.int().min(1).max(MAX_SUBJECT_LIST_LIMIT).default(DEFAULT_SUBJECT_LIST_LIMIT),
});
export type ListSubjectsInput = z.input<typeof listSubjectsInputSchema>;

// How many visible documents concern each subject; a subject no visible document
// concerns is absent.
const visibleDocumentCounts = async (
  db: Database,
  includePrivate: boolean,
): Promise<ReadonlyMap<string, number>> => {
  const listed = sql<string>`listed.subject_id`;
  const rows = await db
    .select({ id: listed, documents: count() })
    .from(
      sql`${documents} CROSS JOIN LATERAL unnest(${documents.subjectIds}) AS listed(subject_id)`,
    )
    .where(visibleDocument(includePrivate))
    .groupBy(listed);
  return new Map(rows.map((row) => [row.id, row.documents]));
};

/**
 * The subjects a reader may see, oldest first, each with its names and the number of
 * visible documents that concern it. A query keeps the subjects `get_subject` would
 * offer for it. A subject that no visible document concerns is never listed: all that
 * is known of it came from documents the caller may not see.
 */
export const listSubjects = async (
  { db }: KnowledgeReadContext,
  input: ListSubjectsInput,
): Promise<SubjectList> => {
  const { query, kind, includePrivate, limit } = listSubjectsInputSchema.parse(input);
  const counts = await visibleDocumentCounts(db, includePrivate);
  const shown = (await loadSubjects(db, kind)).filter(
    shownTo(new Set(counts.keys()), includePrivate),
  );
  const matching = query === undefined ? shown : designatedBy(shown, query);
  return {
    subjects: matching.slice(0, limit).map(({ id, kind: subjectKind, canonicalName, aliases }) => ({
      id,
      kind: subjectKind,
      name: canonicalName,
      aliases,
      document_count: counts.get(id) ?? 0,
    })),
    truncated: matching.length > limit,
  };
};
