import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { docTypes } from '../db/schema/registry.ts';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.ts';
import { InvalidTypeSchemaError } from './stored-schema.ts';
import {
  findTypeById,
  insertType,
  type NewType,
  updateTypeFields,
  withRegistryLock,
} from './type-store.ts';

const EMBEDDING = [0.5, 0.25, 0.125];

const newType = (slug: string, fields: unknown): NewType => ({
  slug,
  description: `Synthetic ${slug}`,
  parentSlug: null,
  fields,
  embedding: EMBEDDING,
  createdAt: new Date('2026-01-15T10:00:00.000Z'),
});

describe('type store', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase({ embeddingDim: EMBEDDING.length });
  });

  afterAll(async () => {
    await database.dispose();
  });

  it('refuses to insert a type whose fields are not valid', async () => {
    await expect(
      withRegistryLock(database.db, (tx) =>
        insertType(tx, newType('invalid_insert', { notes: { type: 'object' } })),
      ),
    ).rejects.toThrow(InvalidTypeSchemaError);
    expect(await database.db.$count(docTypes, eq(docTypes.slug, 'invalid_insert'))).toBe(0);
  });

  it('refuses to update a type with fields that are not valid, and keeps its version', async () => {
    const type = await withRegistryLock(database.db, (tx) =>
      insertType(tx, newType('invalid_update', { note: { type: 'text' } })),
    );
    await expect(
      withRegistryLock(database.db, (tx) =>
        updateTypeFields(tx, type, { amount: { type: 'money' } }),
      ),
    ).rejects.toThrow(InvalidTypeSchemaError);
    expect(await findTypeById(database.db, type.id)).toEqual(type);
  });

  it('serializes the work done under the registry lock', async () => {
    const order: string[] = [];
    const pause = (milliseconds: number) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds));
    const work = (label: string) =>
      withRegistryLock(database.db, async () => {
        order.push(`${label} starts`);
        await pause(50);
        order.push(`${label} ends`);
      });
    await Promise.all([work('first'), work('second'), work('third')]);
    expect(
      order.filter((_, index) => index % 2 === 0).every((entry) => entry.endsWith('starts')),
    ).toBe(true);
    expect(
      order.filter((_, index) => index % 2 === 1).every((entry) => entry.endsWith('ends')),
    ).toBe(true);
  });
});
