import { boolean, index, integer, jsonb, pgTable, primaryKey, text } from 'drizzle-orm/pg-core';
import { ID_PREFIXES, newId } from '../../domain/ids.ts';
import { createdAt, instant, type JsonObject, jsonObject } from '../columns.ts';
import { documents } from './documents.ts';
import { sourceKind } from './enums.ts';

/**
 * A place documents are read from, configured in the web UI. `config` is the setup of its
 * kind, `secret` its credentials sealed by the secret box of `@liasse/core/settings` under
 * `source:<id>`, `cursor` where the next run starts, in the shape its connector defines.
 * No row per item: the cursor and the hash dedup of ingestion are the whole state.
 */
export const ingestionSources = pgTable('ingestion_sources', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => newId(ID_PREFIXES.ingestionSource)),
  kind: sourceKind('kind').notNull(),
  name: text('name').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  pollIntervalMinutes: integer('poll_interval_minutes').notNull(),
  // Given with every item to ingestion: untrusted free text, as the hint of an upload.
  hint: text('hint'),
  private: boolean('private').notNull().default(false),
  config: jsonObject('config'),
  secret: text('secret'),
  cursor: jsonb('cursor').$type<JsonObject>(),
  // Set when the credentials were refused; cleared by a save of the source.
  needsAttention: boolean('needs_attention').notNull().default(false),
  lastRun: jsonb('last_run').$type<JsonObject>(),
  createdAt: createdAt(),
  // When a person last saved the source; a run writes its cursor and summary without it.
  updatedAt: instant('updated_at').notNull().defaultNow(),
});

/**
 * Where a document was found by a source. Ingestion deduplicates by hash, so one document
 * may come from several sources, or from one source under several names.
 */
export const documentOrigins = pgTable(
  'document_origins',
  {
    documentId: text('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    sourceId: text('source_id')
      .notNull()
      .references(() => ingestionSources.id, { onDelete: 'cascade' }),
    // What the source calls the item, in a form of its connector.
    externalId: text('external_id').notNull(),
    name: text('name').notNull(),
    // What the source says of the bytes, for a source that keeps the file (Drive's md5):
    // a later read compares it before serving them.
    checksum: text('checksum'),
    // When the source stopped holding the item where the configuration points: trashed,
    // deleted or moved out. A document whose file is at a source then cannot serve it.
    removedAt: instant('removed_at'),
    firstSeenAt: instant('first_seen_at').notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.documentId, table.sourceId, table.externalId] }),
    index('document_origins_source_id_idx').on(table.sourceId),
  ],
);
