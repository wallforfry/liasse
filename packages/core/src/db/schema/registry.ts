import { boolean, integer, jsonb, pgTable, text } from 'drizzle-orm/pg-core';
import { ID_PREFIXES, newId } from '../../domain/ids.ts';
import {
  createdAt,
  embeddingVector,
  type JsonObject,
  jsonObject,
  textArray,
  updatedAt,
} from '../columns.ts';
import { changeKind, changeStatus, entityKind, typeStatus } from './enums.ts';

export const docTypes = pgTable('doc_types', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => newId(ID_PREFIXES.docType)),
  slug: text('slug').notNull().unique(),
  description: text('description').notNull(),
  schema: jsonObject('schema'),
  version: integer('version').notNull().default(1),
  status: typeStatus('status').notNull().default('provisional'),
  parentSlug: text('parent_slug'),
  aliases: textArray('aliases'),
  embedding: embeddingVector('embedding'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const entities = pgTable('entities', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => newId(ID_PREFIXES.entity)),
  kind: entityKind('kind').notNull(),
  canonicalName: text('canonical_name').notNull(),
  aliases: textArray('aliases'),
  identifiers: jsonObject('identifiers'),
  embedding: embeddingVector('embedding'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const typeChanges = pgTable('type_changes', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => newId(ID_PREFIXES.typeChange)),
  kind: changeKind('kind').notNull(),
  payload: jsonb('payload').$type<JsonObject>().notNull(),
  rationale: text('rationale').notNull(),
  status: changeStatus('status').notNull().default('pending'),
  auto: boolean('auto').notNull().default(false),
  createdAt: createdAt(),
});
