import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.ts';
import { jobs } from './jobs.ts';
import { docTypes, entities, typeChanges } from './registry.ts';

const EMBEDDING = [0.5, 0.25, 0.125];

describe('doc_types, entities, type_changes and jobs', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase({ embeddingDim: EMBEDDING.length });
  });

  afterAll(async () => {
    await database.dispose();
  });

  it('round-trips doc_types', async () => {
    const [inserted] = await database.db
      .insert(docTypes)
      .values({
        slug: 'energy_bill',
        description: 'Bill from an electricity or gas supplier for a home',
        schema: { fields: { consumption_kwh: { type: 'number' } } },
        parentSlug: 'bill',
        aliases: ['electricity_bill'],
        embedding: EMBEDDING,
      })
      .returning();
    const [selected] = await database.db
      .select()
      .from(docTypes)
      .where(eq(docTypes.slug, 'energy_bill'));
    expect(selected).toEqual(inserted);
    expect(selected).toMatchObject({
      description: 'Bill from an electricity or gas supplier for a home',
      schema: { fields: { consumption_kwh: { type: 'number' } } },
      version: 1,
      status: 'provisional',
      parentSlug: 'bill',
      aliases: ['electricity_bill'],
      embedding: EMBEDDING,
    });
    expect(selected?.id).toMatch(/^typ_/);
  });

  it('gives doc_types exactly its columns: the document count is not stored', async () => {
    const columns = await database.db.execute(sql`
      SELECT column_name AS name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'doc_types'
      ORDER BY ordinal_position
    `);
    expect(columns.map(({ name }) => name)).toEqual([
      'id',
      'slug',
      'description',
      'schema',
      'version',
      'status',
      'parent_slug',
      'aliases',
      'embedding',
      'created_at',
      'updated_at',
    ]);
  });

  it('rejects a second type with the same slug', async () => {
    await database.db.insert(docTypes).values({ slug: 'contract', description: 'A contract' });
    await expect(
      database.db.insert(docTypes).values({ slug: 'contract', description: 'Another one' }),
    ).rejects.toThrow();
  });

  it('round-trips entities', async () => {
    const [inserted] = await database.db
      .insert(entities)
      .values({
        kind: 'org',
        canonicalName: 'Synthetic Energy',
        aliases: ['Synthetic Energy SA'],
        identifiers: { company_id: '000000000' },
        embedding: EMBEDDING,
      })
      .returning();
    const [selected] = await database.db
      .select()
      .from(entities)
      .where(eq(entities.canonicalName, 'Synthetic Energy'));
    expect(selected).toEqual(inserted);
    expect(selected).toMatchObject({
      kind: 'org',
      aliases: ['Synthetic Energy SA'],
      identifiers: { company_id: '000000000' },
      embedding: EMBEDDING,
    });
    expect(selected?.id).toMatch(/^ent_/);
  });

  it('round-trips type_changes', async () => {
    const [inserted] = await database.db
      .insert(typeChanges)
      .values({
        kind: 'merge',
        payload: { source: 'electricity_bill', target: 'energy_bill' },
        rationale: 'Same schema and issuer set.',
      })
      .returning();
    const [selected] = await database.db
      .select()
      .from(typeChanges)
      .where(eq(typeChanges.kind, 'merge'));
    expect(selected).toEqual(inserted);
    expect(selected).toMatchObject({
      payload: { source: 'electricity_bill', target: 'energy_bill' },
      rationale: 'Same schema and issuer set.',
      status: 'pending',
      auto: false,
    });
    expect(selected?.id).toMatch(/^chg_/);
    expect(selected?.createdAt).toBeInstanceOf(Date);
  });

  it('round-trips jobs', async () => {
    const runAfter = new Date('2026-01-01T00:00:00.000Z');
    const [inserted] = await database.db
      .insert(jobs)
      .values({ kind: 'extract', payload: { document_id: 'doc_synthetic' }, runAfter })
      .returning();
    const [selected] = await database.db.select().from(jobs).where(eq(jobs.kind, 'extract'));
    expect(selected).toEqual(inserted);
    expect(selected).toMatchObject({
      payload: { document_id: 'doc_synthetic' },
      status: 'queued',
      attempts: 0,
      maxAttempts: 3,
      runAfter,
      lockedAt: null,
      lastError: null,
    });
    expect(selected?.id).toMatch(/^job_/);
  });
});
