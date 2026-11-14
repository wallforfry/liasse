import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { entities } from '../db/schema/registry.ts';
import { createFakeTextModel } from '../testing/fake-text-model.ts';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.ts';
import type { EntitiesContext } from './context.ts';
import { EntityResolutionContendedError, resolveEntity } from './resolve.ts';
import {
  atSimilarity,
  gatedTextModel,
  recordingEmbedder,
  seedEntity,
  TEST_IDENTIFIER_KEY,
} from './support.test-helper.ts';

const PUBLIC = { allowExternalEmbedding: true } as const;
const PRIVATE = { allowExternalEmbedding: false } as const;

describe('resolveEntity while the text model arbitrates', () => {
  let database: TestDatabase;

  const context = (overrides: Partial<EntitiesContext> = {}): EntitiesContext => ({
    db: database.db,
    embedder: recordingEmbedder(),
    textModel: createFakeTextModel([]),
    identifierKey: TEST_IDENTIFIER_KEY,
    ...overrides,
  });

  const candidate = (name: string, cosine: number, axis: number): Promise<string> =>
    seedEntity(database.db, { name, embedding: atSimilarity(cosine, axis) });

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  beforeEach(async () => {
    await database.db.delete(entities);
  });

  afterAll(async () => {
    await database.dispose();
  });

  it('lets another resolution create its entity meanwhile', async () => {
    const id = await candidate('Synthetic Energy', 0.85, 1);
    const textModel = gatedTextModel([{ choice: id }]);
    const arbitrated = resolveEntity(context({ textModel }), { name: 'Synthetic Power' }, PUBLIC);
    await textModel.entered;
    const created = await resolveEntity(
      context({ embedder: recordingEmbedder(false) }),
      { name: 'Acme Widgets' },
      PRIVATE,
    );
    expect(created.match).toBe('created');
    textModel.release();
    expect(await arbitrated).toMatchObject({ entity_id: id, match: 'arbitration' });
  });

  it('does not ask about a mention that a name already settles', async () => {
    await candidate('Synthetic Energy', 0.85, 1);
    const named = await seedEntity(database.db, { name: 'Synthetic Power' });
    const textModel = createFakeTextModel([]);
    const resolution = await resolveEntity(
      context({ textModel }),
      { name: 'Synthetic Power SA', identifiers: [{ type: 'company_id', value: '999990001' }] },
      PUBLIC,
    );
    expect(resolution).toMatchObject({ entity_id: named, match: 'name' });
    expect(textModel.calls).toHaveLength(0);
  });

  it('asks again when the closest candidates changed meanwhile', async () => {
    const first = await candidate('Synthetic Energy', 0.85, 1);
    const textModel = gatedTextModel([{ choice: first }, { choice: 'none' }]);
    const arbitrated = resolveEntity(context({ textModel }), { name: 'Synthetic Power' }, PUBLIC);
    await textModel.entered;
    const second = await candidate('Synthetic Power Grid', 0.9, 2);
    textModel.release();
    expect(await arbitrated).toMatchObject({ match: 'created' });
    expect(textModel.calls).toHaveLength(2);
    expect(textModel.calls[0]?.prompt).not.toContain(second);
    expect(textModel.calls[1]?.prompt).toContain(second);
  });

  it('does not attach to a candidate that is gone when the answer comes', async () => {
    const id = await candidate('Synthetic Energy', 0.85, 1);
    const textModel = gatedTextModel([{ choice: id }]);
    const arbitrated = resolveEntity(context({ textModel }), { name: 'Synthetic Power' }, PUBLIC);
    await textModel.entered;
    await database.db.delete(entities).where(eq(entities.id, id));
    textModel.release();
    const resolution = await arbitrated;
    expect(resolution.match).toBe('created');
    expect(resolution.entity_id).not.toBe(id);
    expect(textModel.calls).toHaveLength(1);
  });

  it('prefers an entity of that very name created meanwhile', async () => {
    const id = await candidate('Synthetic Energy', 0.85, 1);
    const textModel = gatedTextModel([{ choice: id }]);
    const arbitrated = resolveEntity(context({ textModel }), { name: 'Synthetic Power' }, PUBLIC);
    await textModel.entered;
    const namesake = await seedEntity(database.db, { name: 'SYNTHETIC POWER SA' });
    textModel.release();
    expect(await arbitrated).toMatchObject({ entity_id: namesake, match: 'name' });
  });

  it('gives up when the candidates change again during the second arbitration', async () => {
    await candidate('Synthetic Energy', 0.85, 1);
    const additions = [0.86, 0.87];
    const textModel = createFakeTextModel(async () => {
      const cosine = additions.shift() ?? 0.88;
      await candidate(`Added at ${String(cosine)}`, cosine, Math.round(cosine * 100));
      return { choice: 'none' };
    });
    const failure = resolveEntity(context({ textModel }), { name: 'Synthetic Power' }, PUBLIC);
    await expect(failure).rejects.toBeInstanceOf(EntityResolutionContendedError);
    expect(textModel.calls).toHaveLength(2);
    expect(await database.db.$count(entities)).toBe(3);
  });
});
