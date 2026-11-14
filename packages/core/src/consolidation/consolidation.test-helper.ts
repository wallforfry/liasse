import { asc, eq } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import type { JsonObject } from '../db/columns.ts';
import { documents } from '../db/schema/documents.ts';
import { jobs } from '../db/schema/jobs.ts';
import { docTypes, typeChanges } from '../db/schema/registry.ts';
import type { ChangeKind, TypeStatus } from '../domain/enums.ts';
import { createType } from '../registry/create-type.ts';
import { findTypeById, type RegisteredType } from '../registry/type-store.ts';
import { createFakeEmbedder } from '../testing/fake-embedder.ts';
import { insertSyntheticDocument, type NewDocumentRow } from '../testing/fixtures.ts';

export const EXTRACTED = { model: 'm', schema_version: 1, confidence: 0.9, page: 1, quote: 'q' };

export interface SeededType {
  readonly slug: string;
  readonly fields?: JsonObject;
  readonly description?: string;
  readonly status?: TypeStatus;
}

export const seedType = async (
  db: Database,
  { slug, fields = {}, description = `Synthetic ${slug}`, status }: SeededType,
): Promise<RegisteredType> => {
  const created = await createType(
    { slug, description, fields },
    { db, embedder: createFakeEmbedder(), maxNewTypesPerDay: 1000, schemaLanguage: 'en' },
  );
  if (!created.ok) throw new Error(created.error.message);
  if (status === undefined) return created.value;
  await db.update(docTypes).set({ status }).where(eq(docTypes.id, created.value.id));
  return { ...created.value, status };
};

export const typeOf = async (db: Database, id: string): Promise<RegisteredType | undefined> =>
  findTypeById(db, id);

/** An indexed document of a type, ready for consolidation to count. */
export const seedDocument = async (
  db: Database,
  typeId: string,
  overrides: Partial<NewDocumentRow> = {},
): Promise<string> =>
  (
    await insertSyntheticDocument(db, {
      status: 'indexed',
      typeId,
      schemaVersion: 1,
      confidence: 0.9,
      title: 'Synthetic document',
      ...overrides,
    })
  ).id;

export const documentOf = async (db: Database, id: string) => {
  const [row] = await db.select().from(documents).where(eq(documents.id, id));
  if (row === undefined) throw new Error(`No document ${id}`);
  return row;
};

export const seedChange = async (
  db: Database,
  kind: ChangeKind,
  payload: JsonObject,
  auto = false,
): Promise<string> => {
  const [row] = await db
    .insert(typeChanges)
    .values({ kind, payload, rationale: 'Synthetic rationale.', auto })
    .returning({ id: typeChanges.id });
  if (row === undefined) throw new Error('The change was not seeded');
  return row.id;
};

export const changesOf = (db: Database, kind?: ChangeKind) =>
  db
    .select()
    .from(typeChanges)
    .where(kind === undefined ? undefined : eq(typeChanges.kind, kind))
    .orderBy(asc(typeChanges.id));

export const queuedReextractions = async (db: Database): Promise<readonly unknown[]> =>
  (
    await db
      .select({ payload: jobs.payload })
      .from(jobs)
      .where(eq(jobs.kind, 'reextract_document'))
      .orderBy(asc(jobs.id))
  ).map(({ payload }) => payload.documentId);
