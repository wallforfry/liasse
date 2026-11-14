import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { facts, subjects } from '../db/schema/knowledge.ts';
import { entities } from '../db/schema/registry.ts';
import { seedEntity } from '../entities/support.test-helper.ts';
import { seedSubject } from '../knowledge/support.test-helper.ts';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.ts';
import { decideChange } from './apply-change.ts';
import {
  changesOf,
  documentOf,
  seedChange,
  seedDocument,
  seedType,
  typeOf,
} from './consolidation.test-helper.ts';

describe('deciding a change', () => {
  let database: TestDatabase;
  const db = () => database.db;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database.dispose();
  });

  const statusOf = async (id: string) => (await changesOf(db())).find((change) => change.id === id);

  it('rejects a change with the note of the person, and decides it once', async () => {
    const type = await seedType(db(), { slug: 'rejected_type' });
    const change = await seedChange(db(), 'stabilize', { type_id: type.id }, true);
    expect(await decideChange(db(), change, 'reject', 'Too early.')).toMatchObject({
      outcome: 'decided',
      decided: { change: { status: 'rejected', note: 'Too early.' }, reextractions: 0 },
    });
    expect((await statusOf(change))?.decidedAt).toBeInstanceOf(Date);
    expect(await decideChange(db(), change, 'apply', null)).toMatchObject({
      outcome: 'already_decided',
      change: { status: 'rejected' },
    });
    expect(await typeOf(db(), type.id)).toMatchObject({ status: 'provisional' });
  });

  it('knows no change by an id it never gave', async () => {
    expect(await decideChange(db(), 'chg_01JC0000000000000000000000', 'apply', null)).toEqual({
      outcome: 'not_found',
    });
    expect(await decideChange(db(), 'not an id', 'apply', null)).toEqual({
      outcome: 'not_found',
    });
  });

  it('rejects a change whose payload it cannot read rather than try it again', async () => {
    const change = await seedChange(db(), 'stabilize', { type: 'unexpected' });
    expect(await decideChange(db(), change, 'apply', null)).toMatchObject({
      decided: { change: { status: 'rejected' }, refusal: { code: 'unsupported_change' } },
    });
  });

  it('merges two entities and points every reference of the source at the target', async () => {
    const target = await seedEntity(db(), { name: 'Synthetic Power' });
    const source = await seedEntity(db(), { name: 'Synthetic Power SA' });
    const type = await seedType(db(), { slug: 'entity_bill' });
    const document = await seedDocument(db(), type.id, {
      core: { issuer: 'Synthetic Power SA' },
      provenance: { issuer: { entity_id: source, match: 'created', confidence: 1 } },
    });
    await db()
      .insert(facts)
      .values({ documentId: document, text: 'A synthetic fact.', entityIds: [source] });
    const change = await seedChange(db(), 'merge_entity', {
      source_id: source,
      target_id: target,
    });

    expect(await decideChange(db(), change, 'apply', null)).toMatchObject({
      decided: { change: { status: 'applied' } },
    });
    expect(await documentOf(db(), document)).toMatchObject({
      provenance: { issuer: { entity_id: target } },
    });
    const [fact] = await db()
      .select({ entityIds: facts.entityIds })
      .from(facts)
      .where(eq(facts.documentId, document));
    expect(fact?.entityIds).toEqual([target]);
    expect(await db().$count(entities, eq(entities.id, source))).toBe(0);
  });

  it('closes a merge of a person into an organisation as rejected, never to be tried again', async () => {
    const organisation = await seedEntity(db(), { name: 'Synthetic Cross SA', kind: 'org' });
    const person = await seedEntity(db(), { name: 'Jane Cross', kind: 'person' });
    const change = await seedChange(
      db(),
      'merge_entity',
      { source_id: person, target_id: organisation },
      true,
    );
    expect(await decideChange(db(), change, 'apply', 'Applied automatically.')).toMatchObject({
      decided: {
        change: { status: 'rejected', note: expect.stringContaining('Applied automatically.') },
        refusal: { code: 'kind_mismatch' },
      },
    });
    expect(await db().$count(entities, eq(entities.id, person))).toBe(1);
  });

  it('merges two subjects and rewrites the subjects of documents and facts', async () => {
    const target = await seedSubject(db(), { kind: 'vehicle', name: 'Blue car' });
    const source = await seedSubject(db(), { kind: 'vehicle', name: 'The blue car' });
    const type = await seedType(db(), { slug: 'subject_bill' });
    const document = await seedDocument(db(), type.id, { subjectIds: [source] });
    await db()
      .insert(facts)
      .values({ documentId: document, text: 'A synthetic car fact.', subjectIds: [source] });
    const change = await seedChange(db(), 'merge_subject', {
      source_id: source,
      target_id: target,
    });

    expect(await decideChange(db(), change, 'apply', null)).toMatchObject({
      decided: { change: { status: 'applied' } },
    });
    expect(await documentOf(db(), document)).toMatchObject({ subjectIds: [target] });
    const [fact] = await db()
      .select({ subjectIds: facts.subjectIds })
      .from(facts)
      .where(eq(facts.documentId, document));
    expect(fact?.subjectIds).toEqual([target]);
    expect(await db().$count(subjects, eq(subjects.id, source))).toBe(0);
  });
});
