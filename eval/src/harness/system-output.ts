import {
  type Database,
  docTypes,
  documentDates,
  documentLinks,
  documentPages,
  documents,
  entities,
  facts,
  subjects,
} from '@liasse/core/db';
import { readPipelineProvenance } from '@liasse/core/domain';
import { CORE_FIELDS } from '@liasse/core/registry';
import { asc, eq, inArray } from 'drizzle-orm';
import type { SystemDocument } from '../schema/index.ts';
import type { CorpusIds } from './ingest.ts';

// Stands for a document of the instance that is no document of the corpus: a link or a
// citation to it is judged like any other the truth does not list.
export const UNKNOWN_DOCUMENT = 'unknown-document';

const CORE_NAMES: readonly string[] = Object.keys(CORE_FIELDS);

/**
 * What the instance holds for one document, in the terms of the corpus. The values are
 * the stored ones, unchecked: `scoreDocument` parses them and answers an invalid output
 * rather than throwing.
 */
export type SystemOutput = { readonly [Part in keyof SystemDocument]: unknown };

/** The output for a document the instance does not hold: it found nothing of it. */
export const emptyOutput = (id: string): SystemDocument => ({
  id,
  duplicate_of: null,
  type: null,
  core: {},
  key_dates: [],
  fields: {},
  extra: {},
  provenance: {},
  title: null,
  summary: null,
  links: [],
  subjects: [],
  facts: [],
  private: false,
  pages: [],
});

const namesById = async (
  db: Database,
  table: typeof entities | typeof subjects,
  ids: readonly string[],
): Promise<ReadonlyMap<string, string>> =>
  ids.length === 0
    ? new Map()
    : new Map(
        (
          await db
            .select({ id: table.id, name: table.canonicalName })
            .from(table)
            .where(inArray(table.id, [...new Set(ids)]))
        ).map(({ id, name }) => [id, name]),
      );

const readFacts = async (db: Database, documentId: string) => {
  const rows = await db
    .select({
      text: facts.text,
      validFrom: facts.validFrom,
      validTo: facts.validTo,
      entityIds: facts.entityIds,
      subjectIds: facts.subjectIds,
    })
    .from(facts)
    .where(eq(facts.documentId, documentId));
  const [entityNames, subjectNames] = await Promise.all([
    namesById(
      db,
      entities,
      rows.flatMap(({ entityIds }) => entityIds),
    ),
    namesById(
      db,
      subjects,
      rows.flatMap(({ subjectIds }) => subjectIds),
    ),
  ]);
  const named = (ids: readonly string[], names: ReadonlyMap<string, string>) =>
    ids.flatMap((id) => names.get(id) ?? []);
  return rows.map(({ text, validFrom, validTo, entityIds, subjectIds }) => ({
    text,
    valid_from: validFrom,
    valid_to: validTo,
    entities: named(entityIds, entityNames),
    subjects: named(subjectIds, subjectNames),
  }));
};

const readRow = async (db: Database, documentId: string) => {
  const [row] = await db
    .select({
      slug: docTypes.slug,
      parentSlug: docTypes.parentSlug,
      core: documents.core,
      fields: documents.fields,
      extra: documents.extra,
      provenance: documents.provenance,
      title: documents.title,
      summary: documents.summary,
      private: documents.private,
      subjectIds: documents.subjectIds,
    })
    .from(documents)
    .leftJoin(docTypes, eq(docTypes.id, documents.typeId))
    .where(eq(documents.id, documentId));
  if (row === undefined) throw new Error(`The instance has no document ${documentId}`);
  return row;
};

const readParts = (db: Database, documentId: string) =>
  Promise.all([
    db
      .select({ page: documentPages.page, text: documentPages.text })
      .from(documentPages)
      .where(eq(documentPages.documentId, documentId))
      .orderBy(asc(documentPages.page)),
    db
      .select({ kind: documentDates.kind, date: documentDates.date, label: documentDates.label })
      .from(documentDates)
      .where(eq(documentDates.documentId, documentId)),
    db
      .select({ kind: documentLinks.kind, to: documentLinks.toDocumentId })
      .from(documentLinks)
      .where(eq(documentLinks.fromDocumentId, documentId)),
    readFacts(db, documentId),
  ]);

/**
 * Reads what the instance stored for one corpus document, as it stored it, and names
 * the documents it links to by their corpus id. The text method is recorded for the
 * whole document: a mixed one has its pages reported as native.
 */
export const readSystemOutput = async (
  db: Database,
  ids: CorpusIds,
  corpusId: string,
): Promise<SystemOutput> => {
  const liasseId = ids.liasseOf(corpusId);
  if (liasseId === undefined) return emptyOutput(corpusId);
  const row = await readRow(db, liasseId);
  const [pages, dates, links, documentFacts] = await readParts(db, liasseId);
  const subjectRows =
    row.subjectIds.length === 0
      ? []
      : await db
          .select({ kind: subjects.kind, label: subjects.canonicalName })
          .from(subjects)
          .where(inArray(subjects.id, [...row.subjectIds]));
  const method =
    readPipelineProvenance(row.provenance).text?.method === 'vision' ? 'vision' : 'native';
  return {
    id: corpusId,
    duplicate_of: ids.duplicateOf(corpusId),
    type: row.slug === null ? null : { slug: row.slug, parent_slug: row.parentSlug },
    core: Object.fromEntries(
      Object.entries(row.core).filter(([name]) => CORE_NAMES.includes(name)),
    ),
    key_dates: dates,
    fields: row.fields,
    extra: row.extra,
    provenance: row.provenance,
    title: row.title,
    summary: row.summary,
    links: links.map(({ kind, to }) => ({ kind, target: ids.corpusOf(to) ?? UNKNOWN_DOCUMENT })),
    subjects: subjectRows,
    facts: documentFacts,
    private: row.private,
    pages: pages.map(({ page, text }) => ({ page, method, text })),
  };
};
