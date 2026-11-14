import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { documents } from '../db/schema/documents.ts';
import { facts, subjects } from '../db/schema/knowledge.ts';
import { entities, typeChanges } from '../db/schema/registry.ts';
import { ID_PREFIXES, newId } from '../domain/ids.ts';
import { deleteDocument } from '../ingest/delete-document.ts';
import {
  storeSubjectIdentifier,
  toSubjectIdentifiersColumn,
} from '../knowledge/subject-identifiers.ts';
import { columnsHolding } from '../testing/column-scan.ts';
import { insertSyntheticDocument } from '../testing/fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.ts';
import { mergeEntities } from './merge.ts';
import { maskSensitiveIdentifier } from './sensitive.ts';
import {
  atSimilarity,
  seedEntity,
  SYNTHETIC_IBAN,
  TEST_IDENTIFIER_KEY,
} from './support.test-helper.ts';

describe('mergeEntities', () => {
  let database: TestDatabase;

  const merge = (sourceId: string, targetId: string) =>
    mergeEntities({ db: database.db }, { sourceId, targetId });

  const rowOf = async (id: string) => {
    const [row] = await database.db.select().from(entities).where(eq(entities.id, id));
    return row;
  };

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database.dispose();
  });

  it('moves the names and the identifiers of the source to the target, and deletes the source', async () => {
    const target = await seedEntity(database.db, {
      name: 'Synthetic Energy',
      aliases: ['SE'],
      identifiers: [
        { type: 'company_id', value: '999990001' },
        { type: 'iban', value: SYNTHETIC_IBAN },
      ],
      embedding: atSimilarity(1),
    });
    const source = await seedEntity(database.db, {
      name: 'Synthetic Energy Group',
      aliases: ['S.E.', 'SYNTHETIC ENERGY SA', 'SE Group'],
      identifiers: [
        { type: 'iban', value: SYNTHETIC_IBAN },
        { type: 'customer_number', value: 'CLT-00412' },
      ],
      embedding: atSimilarity(0.5),
    });
    const result = await merge(source, target);
    const ibanHash = maskSensitiveIdentifier(TEST_IDENTIFIER_KEY, 'iban', SYNTHETIC_IBAN).hash;
    const expected = {
      id: target,
      kind: 'org',
      canonicalName: 'Synthetic Energy',
      aliases: ['SE', 'Synthetic Energy Group', 'SE Group'],
      identifiers: [
        { type: 'company_id', value: '999990001' },
        { type: 'iban', last4: '0146', hash: ibanHash },
        { type: 'customer_number', value: 'CLT00412' },
      ],
    };
    expect(result).toEqual({ ok: true, value: expected });
    expect(await rowOf(target)).toMatchObject({
      canonicalName: expected.canonicalName,
      aliases: expected.aliases,
      identifiers: { items: expected.identifiers },
      embedding: atSimilarity(1),
    });
    expect(await rowOf(source)).toBeUndefined();
  });

  it('gives the target the embedding of the source when it has none', async () => {
    const target = await seedEntity(database.db, { name: 'Target without embedding' });
    const source = await seedEntity(database.db, {
      name: 'Source with embedding',
      embedding: atSimilarity(0),
    });
    await merge(source, target);
    expect((await rowOf(target))?.embedding).toEqual(atSimilarity(0));
  });

  it('leaves no trace of the source id in any column of the database', async () => {
    const target = await seedEntity(database.db, { name: 'Acme Widgets' });
    const source = await seedEntity(database.db, { name: 'Acme Widgets Ltd' });
    const third = await seedEntity(database.db, { name: 'Acme Holding' });
    const by = (entityId: string) => ({ entity_id: entityId, match: 'name', confidence: 0.99 });
    const document = await insertSyntheticDocument(database.db, {
      core: { issuer: 'Acme Widgets Ltd', recipient: 'Acme Widgets Ltd' },
      fields: { insurer: 'Acme Widgets Ltd', parties: ['Acme Holding', 'Acme Widgets Ltd'] },
      provenance: {
        issuer: by(source),
        recipient: by(source),
        insurer: by(source),
        parties: [by(third), by(source)],
      },
    });
    await database.db
      .insert(facts)
      .values({ documentId: document.id, text: 'A synthetic fact.', entityIds: [source, third] });
    await database.db.insert(typeChanges).values({
      kind: 'merge_entity',
      payload: { source_id: third, target_id: source },
      rationale: 'Synthetic rationale.',
    });
    const [contract] = await database.db
      .insert(subjects)
      .values({
        kind: 'contract',
        canonicalName: 'Synthetic contract',
        identifiers: toSubjectIdentifiersColumn(
          storeSubjectIdentifier(TEST_IDENTIFIER_KEY, 'contract', 'CT-123456', source),
        ),
      })
      .returning({ id: subjects.id });
    expect(await columnsHolding(database.db, source)).toEqual([
      'documents.provenance',
      'entities.id',
      'facts.entity_ids',
      'subjects.identifiers',
      'type_changes.payload',
    ]);

    expect(await merge(source, target)).toMatchObject({ ok: true });

    expect(await columnsHolding(database.db, source)).toEqual([]);
    const [after] = await database.db.select().from(documents).where(eq(documents.id, document.id));
    expect(after).toMatchObject({
      core: document.core,
      fields: document.fields,
      provenance: {
        issuer: by(target),
        recipient: by(target),
        insurer: by(target),
        parties: [by(third), by(target)],
      },
    });
    const [rewritten] = await database.db
      .select({ identifiers: subjects.identifiers })
      .from(subjects)
      .where(eq(subjects.id, contract?.id ?? ''));
    expect(rewritten?.identifiers).toEqual({
      items: [{ type: 'contract_number', value: 'CT123456', issuer_id: target }],
    });
  });

  it('leaves no trace of the source id when a document that named it was deleted', async () => {
    const target = await seedEntity(database.db, { name: 'Tombstone target' });
    const source = await seedEntity(database.db, { name: 'Tombstone source' });
    const document = await insertSyntheticDocument(database.db, {
      provenance: { issuer: { entity_id: source, match: 'name', confidence: 0.99 } },
    });
    await database.db
      .insert(facts)
      .values({ documentId: document.id, text: 'A synthetic fact.', entityIds: [source] });
    expect(await deleteDocument({ db: database.db }, document.id)).toBe(true);
    expect(await columnsHolding(database.db, source)).toEqual(['entities.id']);

    expect(await merge(source, target)).toMatchObject({ ok: true });

    expect(await columnsHolding(database.db, source)).toEqual([]);
    const [tombstone] = await database.db
      .select({ status: documents.status, provenance: documents.provenance })
      .from(documents)
      .where(eq(documents.id, document.id));
    expect(tombstone).toEqual({ status: 'deleted', provenance: {} });
  });

  it('merges a source once when two merges of it run at the same time', async () => {
    const source = await seedEntity(database.db, { name: 'Contended source' });
    const targets = await Promise.all(
      ['Contended target one', 'Contended target two'].map((name) =>
        seedEntity(database.db, { name }),
      ),
    );
    const results = await Promise.all(targets.map((target) => merge(source, target)));
    expect(results.filter(({ ok }) => ok)).toHaveLength(1);
    expect(results.find(({ ok }) => !ok)).toMatchObject({ error: { code: 'entity_not_found' } });
    const rows = await Promise.all(targets.map(rowOf));
    expect(rows.flatMap((row) => row?.aliases ?? [])).toEqual(['Contended source']);
  });

  it('refuses to merge an entity into itself', async () => {
    const id = await seedEntity(database.db, { name: 'Self' });
    expect(await merge(id, id)).toMatchObject({ ok: false, error: { code: 'self_merge' } });
    expect(await rowOf(id)).toBeDefined();
  });

  it('refuses to merge a person into an organization, and changes nothing', async () => {
    const person = await seedEntity(database.db, { kind: 'person', name: 'Jane Doe' });
    const org = await seedEntity(database.db, { name: 'Doe Consulting' });
    const document = await insertSyntheticDocument(database.db, {
      provenance: { issuer: { entity_id: person } },
    });
    expect(await merge(person, org)).toEqual({
      ok: false,
      error: {
        code: 'kind_mismatch',
        message: 'An entity of kind "person" cannot be merged into one of kind "org".',
        sourceKind: 'person',
        targetKind: 'org',
      },
    });
    expect(await rowOf(person)).toBeDefined();
    expect((await rowOf(org))?.aliases).toEqual([]);
    const [after] = await database.db
      .select({ provenance: documents.provenance })
      .from(documents)
      .where(eq(documents.id, document.id));
    expect(after?.provenance).toEqual({ issuer: { entity_id: person } });
  });

  it.each([
    ['an unknown source', 'source'],
    ['an unknown target', 'target'],
  ] as const)('refuses %s', async (_case, missing) => {
    const known = await seedEntity(database.db, { name: `Known beside ${missing}` });
    const unknown = newId(ID_PREFIXES.entity);
    const result = missing === 'source' ? await merge(unknown, known) : await merge(known, unknown);
    expect(result).toMatchObject({ ok: false, error: { code: 'entity_not_found', id: unknown } });
    expect(await rowOf(known)).toBeDefined();
  });

  it('holds an id that is not well-formed as unknown', async () => {
    const known = await seedEntity(database.db, { name: 'Known beside a malformed id' });
    await database.db
      .insert(entities)
      .values({ id: 'ent_"quoted"', kind: 'org', canonicalName: 'Malformed id' });
    expect(await merge('ent_"quoted"', known)).toMatchObject({
      ok: false,
      error: { code: 'entity_not_found', id: 'ent_"quoted"' },
    });
  });

  it('is part of the transaction of the caller, and is undone by its rollback', async () => {
    const target = await seedEntity(database.db, { name: 'Caller target' });
    const source = await seedEntity(database.db, { name: 'Caller source' });
    const document = await insertSyntheticDocument(database.db, {
      provenance: { issuer: { entity_id: source } },
    });
    const provenance = async () => {
      const [row] = await database.db
        .select({ provenance: documents.provenance })
        .from(documents)
        .where(eq(documents.id, document.id));
      return row?.provenance;
    };
    await expect(
      database.db.transaction(async (tx) => {
        const result = await mergeEntities({ db: tx }, { sourceId: source, targetId: target });
        expect(result).toMatchObject({ ok: true });
        throw new Error('synthetic rollback');
      }),
    ).rejects.toThrow('synthetic rollback');
    expect(await rowOf(source)).toBeDefined();
    expect((await rowOf(target))?.aliases).toEqual([]);
    expect(await provenance()).toEqual({ issuer: { entity_id: source } });

    await database.db.transaction(async (tx) => {
      await mergeEntities({ db: tx }, { sourceId: source, targetId: target });
      await tx
        .update(entities)
        .set({ canonicalName: 'Renamed by the caller' })
        .where(eq(entities.id, target));
    });
    expect(await rowOf(source)).toBeUndefined();
    expect(await rowOf(target)).toMatchObject({
      canonicalName: 'Renamed by the caller',
      aliases: ['Caller source'],
    });
    expect(await provenance()).toEqual({ issuer: { entity_id: target } });
  });

  it('refuses a transaction of the caller that is not read committed', async () => {
    const target = await seedEntity(database.db, { name: 'Isolation target' });
    const source = await seedEntity(database.db, { name: 'Isolation source' });
    await expect(
      database.db.transaction(
        (tx) => mergeEntities({ db: tx }, { sourceId: source, targetId: target }),
        { isolationLevel: 'repeatable read' },
      ),
    ).rejects.toThrow(/read committed transaction; this one is repeatable read/);
    expect(await rowOf(source)).toBeDefined();
  });

  it('rolls everything back when a step fails', async () => {
    const target = await seedEntity(database.db, { name: 'Rollback target' });
    const source = await seedEntity(database.db, { name: 'Rollback source' });
    const document = await insertSyntheticDocument(database.db, {
      provenance: { issuer: { entity_id: source } },
    });
    await database.db.execute(sql`
      CREATE FUNCTION refuse_delete() RETURNS trigger LANGUAGE plpgsql
        AS $$ BEGIN RAISE EXCEPTION 'synthetic failure'; END $$
    `);
    await database.db.execute(sql`
      CREATE TRIGGER refuse_delete BEFORE DELETE ON entities
        FOR EACH ROW EXECUTE FUNCTION refuse_delete()
    `);
    try {
      await expect(merge(source, target)).rejects.toThrow();
    } finally {
      await database.db.execute(sql`DROP TRIGGER refuse_delete ON entities`);
    }
    const [after] = await database.db
      .select({ provenance: documents.provenance })
      .from(documents)
      .where(eq(documents.id, document.id));
    expect(after?.provenance).toEqual({ issuer: { entity_id: source } });
    expect((await rowOf(target))?.aliases).toEqual([]);
    expect(await rowOf(source)).toBeDefined();
  });
});
