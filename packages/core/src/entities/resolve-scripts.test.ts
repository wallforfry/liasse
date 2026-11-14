import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { entities } from '../db/schema/registry.ts';
import { createFakeTextModel } from '../testing/fake-text-model.ts';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.ts';
import type { EntitiesContext } from './context.ts';
import { findMergeCandidates } from './merge-candidates.ts';
import { listEntities } from './list.ts';
import { resolveEntity } from './resolve.ts';
import { recordingEmbedder, TEST_IDENTIFIER_KEY } from './support.test-helper.ts';

const PRIVATE = { allowExternalEmbedding: false } as const;

describe('resolveEntity on names of every script', () => {
  let database: TestDatabase;

  // No similarity: only the name rule can attach these mentions.
  const context = (): EntitiesContext => ({
    db: database.db,
    embedder: recordingEmbedder(false),
    textModel: createFakeTextModel([]),
    identifierKey: TEST_IDENTIFIER_KEY,
  });

  const resolve = (name: string) => resolveEntity(context(), { name }, PRIVATE);

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  beforeEach(async () => {
    await database.db.delete(entities);
  });

  afterAll(async () => {
    await database.dispose();
  });

  it.each([
    ['東京ガス', '東京カス'],
    ['サトウ商事', 'サドウ商事'],
    ['バンク', 'パンク'],
    ['राम ट्रेडर्स', 'रोम ट्रेडर्स'],
    ['กิน', 'กัน'],
    ['Зайка', 'Заика'],
    ['Ромашка LLC', 'Лютик LLC'],
  ])('creates two entities for %s and %s', async (left, right) => {
    const first = await resolve(left);
    const second = await resolve(right);
    expect([first.match, second.match]).toEqual(['created', 'created']);
    expect(second.entity_id).not.toBe(first.entity_id);
    expect(await findMergeCandidates({ db: database.db })).toEqual([]);
    expect((await listEntities({ db: database.db }, { query: left })).total).toBe(1);
  });

  it.each([
    ['Société Générale SA', 'SOCIETE GENERALE'],
    ['Việt Tiến', 'Viet Tien'],
    ['Ｓｙｎｔｈｅｔｉｃ　Ｅｎｅｒｇｙ', 'Synthetic Energy Ltd'],
    ['東京ガス', '東京ガス'],
  ])('attaches %s and %s to one entity', async (left, right) => {
    const first = await resolve(left);
    expect(await resolve(right)).toMatchObject({ entity_id: first.entity_id, match: 'name' });
  });
});
