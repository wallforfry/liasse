import { sql } from 'drizzle-orm';
import { customType, integer, jsonb, real, text, timestamp } from 'drizzle-orm/pg-core';

// The migration runner replaces this token with EMBEDDING_DIM, so generated SQL
// never hard-codes a dimension.
export const EMBEDDING_DIM_PLACEHOLDER = '__EMBEDDING_DIM__';

export const embeddingVector = customType<{ data: readonly number[]; driverData: string }>({
  dataType: () => `vector(${EMBEDDING_DIM_PLACEHOLDER})`,
  toDriver: (value) => `[${value.join(',')}]`,
  fromDriver: (value) => value.slice(1, -1).split(',').map(Number),
});

export const tsvector = customType<{ data: string }>({
  dataType: () => 'tsvector',
});

// `liasse_tsvector` is the single place that decides the text search configuration.
export const searchVector = (name: string, source: string) =>
  tsvector(name).generatedAlwaysAs(sql.raw(`liasse_tsvector("${source}")`));

export type JsonObject = Readonly<Record<string, unknown>>;

export const jsonObject = (name: string) =>
  jsonb(name)
    .$type<JsonObject>()
    .notNull()
    .default(sql`'{}'::jsonb`);

export const textArray = (name: string) =>
  text(name)
    .array()
    .$type<readonly string[]>()
    .notNull()
    .default(sql`'{}'::text[]`);

// Where an extracted value comes from. All nullable: a value computed by Liasse,
// such as a notice deadline, has no model and no quote.
export const traceColumns = () => ({
  model: text('model'),
  schemaVersion: integer('schema_version'),
  page: integer('page'),
  quote: text('quote'),
  confidence: real('confidence'),
});

export const instant =(name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const createdAt = () => instant('created_at').notNull().defaultNow();

export const updatedAt = () =>
  instant('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
