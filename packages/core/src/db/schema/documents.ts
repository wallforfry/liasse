import { ne, sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  real,
  text,
} from 'drizzle-orm/pg-core';
import { TOMBSTONE_STATUS } from '../../domain/enums.ts';
import { ID_PREFIXES, newId } from '../../domain/ids.ts';
import {
  embeddingVector,
  instant,
  jsonObject,
  searchLanguage,
  searchVector,
  textArray,
  updatedAt,
} from '../columns.ts';
import { documentSource, documentState, documentStatus } from './enums.ts';
import { docTypes } from './registry.ts';

export const documents = pgTable(
  'documents',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => newId(ID_PREFIXES.document)),
    sha256: text('sha256').notNull().unique(),
    storageKey: text('storage_key').notNull(),
    mime: text('mime').notNull(),
    originalName: text('original_name').notNull(),
    // What the caller said about the file at ingestion: untrusted free text.
    hint: text('hint'),
    source: documentSource('source').notNull(),
    status: documentStatus('status').notNull().default('received'),
    state: documentState('state').notNull().default('current'),
    typeId: text('type_id').references(() => docTypes.id),
    schemaVersion: integer('schema_version'),
    core: jsonObject('core'),
    fields: jsonObject('fields'),
    extra: jsonObject('extra'),
    provenance: jsonObject('provenance'),
    title: text('title'),
    summary: text('summary'),
    private: boolean('private').notNull().default(false),
    error: text('error'),
    confidence: real('confidence'),
    manualFields: textArray('manual_fields'),
    subjectIds: textArray('subject_ids'),
    // How many times the watched folder queued this document again after a failure
    // without a person asking: bounded, so a restart loop cannot spend on it forever.
    watchRequeues: integer('watch_requeues').notNull().default(0),
    // Set on a tombstone once its stored file is removed. Null on a tombstone means
    // the removal is still owed, whatever became of its job.
    fileDeletedAt: instant('file_deleted_at'),
    ingestedAt: instant('ingested_at').notNull().defaultNow(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('documents_status_idx').on(table.status),
    index('documents_type_id_idx').on(table.typeId),
    index('documents_subject_ids_idx').using('gin', table.subjectIds),
    check(
      'documents_confidence_range',
      sql`${table.confidence} IS NULL OR ${table.confidence} BETWEEN 0 AND 1`,
    ),
  ],
);

/**
 * A deleted document leaves a tombstone: its row, with the status `deleted`, the hash
 * of its file and none of its content. A tombstone is not a document: every query that
 * lists, counts, searches or serves documents adds this condition to its `where`.
 * `isLiveStatus` in `@liasse/core/domain` is the same rule for a row already read.
 */
export const isLiveDocument = ne(documents.status, TOMBSTONE_STATUS);

export const documentPages = pgTable(
  'document_pages',
  {
    documentId: text('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    page: integer('page').notNull(),
    text: text('text').notNull(),
    language: searchLanguage(),
    tsv: searchVector('tsv', 'text'),
  },
  (table) => [
    primaryKey({ columns: [table.documentId, table.page] }),
    index('document_pages_tsv_idx').using('gin', table.tsv),
    check('document_pages_page_positive', sql`${table.page} >= 1`),
  ],
);

export const chunks = pgTable(
  'chunks',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => newId(ID_PREFIXES.chunk)),
    documentId: text('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    pageFrom: integer('page_from').notNull(),
    pageTo: integer('page_to').notNull(),
    text: text('text').notNull(),
    language: searchLanguage(),
    embedding: embeddingVector('embedding'),
    tsv: searchVector('tsv', 'text'),
  },
  (table) => [
    index('chunks_document_id_idx').on(table.documentId),
    index('chunks_language_idx').on(table.language),
    index('chunks_tsv_idx').using('gin', table.tsv),
    index('chunks_embedding_idx').using('hnsw', table.embedding.op('vector_cosine_ops')),
    check(
      'chunks_page_range',
      sql`${table.pageFrom} >= 1 AND ${table.pageTo} >= ${table.pageFrom}`,
    ),
  ],
);
