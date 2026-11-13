import { sql } from 'drizzle-orm';
import { check, date, index, pgTable, real, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { ID_PREFIXES, newId } from '../../domain/ids.ts';
import {
  createdAt,
  embeddingVector,
  jsonObject,
  searchVector,
  textArray,
  updatedAt,
} from '../columns.ts';
import { documents } from './documents.ts';
import { keyDateKind, linkKind, subjectKind } from './enums.ts';

export const documentDates = pgTable(
  'document_dates',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => newId(ID_PREFIXES.documentDate)),
    documentId: text('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    kind: keyDateKind('kind').notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    label: text('label').notNull(),
    confidence: real('confidence'),
    quote: text('quote'),
    createdAt: createdAt(),
  },
  (table) => [
    index('document_dates_date_idx').on(table.date),
    index('document_dates_document_id_idx').on(table.documentId),
  ],
);

export const documentLinks = pgTable(
  'document_links',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => newId(ID_PREFIXES.documentLink)),
    fromDocumentId: text('from_document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    toDocumentId: text('to_document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    kind: linkKind('kind').notNull(),
    confidence: real('confidence'),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('document_links_unique_idx').on(
      table.fromDocumentId,
      table.toDocumentId,
      table.kind,
    ),
    index('document_links_to_document_id_idx').on(table.toDocumentId),
    check('document_links_distinct', sql`${table.fromDocumentId} <> ${table.toDocumentId}`),
  ],
);

export const subjects = pgTable('subjects', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => newId(ID_PREFIXES.subject)),
  kind: subjectKind('kind').notNull(),
  canonicalName: text('canonical_name').notNull(),
  aliases: textArray('aliases'),
  identifiers: jsonObject('identifiers'),
  embedding: embeddingVector('embedding'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const facts = pgTable(
  'facts',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => newId(ID_PREFIXES.fact)),
    documentId: text('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    validFrom: date('valid_from', { mode: 'string' }),
    validTo: date('valid_to', { mode: 'string' }),
    entityIds: textArray('entity_ids'),
    subjectIds: textArray('subject_ids'),
    embedding: embeddingVector('embedding'),
    tsv: searchVector('tsv', 'text'),
    createdAt: createdAt(),
  },
  (table) => [
    index('facts_document_id_idx').on(table.documentId),
    index('facts_entity_ids_idx').using('gin', table.entityIds),
    index('facts_subject_ids_idx').using('gin', table.subjectIds),
    index('facts_tsv_idx').using('gin', table.tsv),
    index('facts_embedding_idx').using('hnsw', table.embedding.op('vector_cosine_ops')),
    check(
      'facts_validity_range',
      sql`${table.validFrom} IS NULL OR ${table.validTo} IS NULL OR ${table.validTo} >= ${table.validFrom}`,
    ),
  ],
);
