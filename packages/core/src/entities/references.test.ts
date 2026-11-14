import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { documents } from '../db/schema/documents.ts';
import { facts } from '../db/schema/knowledge.ts';
import { typeChanges } from '../db/schema/registry.ts';
import type { ChangeKind, ChangeStatus } from '../domain/enums.ts';
import { ID_PREFIXES, newId } from '../domain/ids.ts';
import { insertSyntheticDocument, type NewDocumentRow } from '../testing/fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.ts';
import { rewriteEntityReferences } from './references.ts';

describe('rewriteEntityReferences', () => {
  let database: TestDatabase;
  let source: string;
  let target: string;
  let other: string;

  const rewrite = (): Promise<void> =>
    database.db.transaction((tx) => rewriteEntityReferences(tx, source, target));

  const rewritten = async (values: Partial<NewDocumentRow>) => {
    const { id } = await insertSyntheticDocument(database.db, values);
    await rewrite();
    const [row] = await database.db.select().from(documents).where(eq(documents.id, id));
    if (row === undefined) throw new Error('The document is gone');
    return row;
  };

  const factAbout = async (entityIds: readonly string[]): Promise<readonly string[]> => {
    const document = await insertSyntheticDocument(database.db);
    const [fact] = await database.db
      .insert(facts)
      .values({ documentId: document.id, text: 'A synthetic fact.', entityIds })
      .returning({ id: facts.id });
    await rewrite();
    const [row] = await database.db
      .select({ entityIds: facts.entityIds })
      .from(facts)
      .where(eq(facts.id, fact?.id ?? ''));
    return row?.entityIds ?? [];
  };

  const changeAbout = async (
    payload: Readonly<Record<string, unknown>>,
    status: ChangeStatus = 'pending',
    kind: ChangeKind = 'merge_entity',
  ): Promise<unknown> => {
    const [change] = await database.db
      .insert(typeChanges)
      .values({ kind, payload, rationale: 'Synthetic rationale.', status })
      .returning({ id: typeChanges.id });
    await rewrite();
    const [row] = await database.db
      .select({ payload: typeChanges.payload })
      .from(typeChanges)
      .where(eq(typeChanges.id, change?.id ?? ''));
    return row?.payload;
  };

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  beforeEach(() => {
    source = newId(ID_PREFIXES.entity);
    target = newId(ID_PREFIXES.entity);
    other = newId(ID_PREFIXES.entity);
  });

  afterAll(async () => {
    await database.dispose();
  });

  const entry = (entityId: string) => ({ entity_id: entityId, match: 'alias', confidence: 0.99 });

  it('rewrites the entity behind the issuer of a document', async () => {
    const { provenance } = await rewritten({
      provenance: { issuer: entry(source), recipient: entry(other) },
    });
    expect(provenance).toEqual({ issuer: entry(target), recipient: entry(other) });
  });

  it('rewrites the entity behind the recipient of a document', async () => {
    const { provenance } = await rewritten({
      provenance: { issuer: entry(other), recipient: entry(source) },
    });
    expect(provenance).toEqual({ issuer: entry(other), recipient: entry(target) });
  });

  it('rewrites the entity behind an entity-typed type field', async () => {
    const { provenance } = await rewritten({ provenance: { insurer: entry(source) } });
    expect(provenance).toEqual({ insurer: entry(target) });
  });

  it('rewrites the entities behind the items of a list field', async () => {
    const { provenance } = await rewritten({
      provenance: { parties: [entry(other), entry(source), entry(source)] },
    });
    expect(provenance).toEqual({ parties: [entry(other), entry(target), entry(target)] });
  });

  it('leaves the rest of the provenance as it is', async () => {
    const amount = { model: 'synthetic-model', confidence: 0.9, page: 1, quote: 'Total 84.20' };
    const { provenance } = await rewritten({ provenance: { issuer: entry(source), amount } });
    expect(provenance).toEqual({ issuer: entry(target), amount });
  });

  it('leaves the name the document writes, in the core and in the type fields', async () => {
    const values = {
      core: { issuer: 'Synthetic Energy SA', reference: source },
      fields: { insurer: 'Acme Insurance', parties: ['Jane Doe', source] },
      extra: { note: source },
    };
    expect(await rewritten({ ...values, provenance: { issuer: entry(source) } })).toMatchObject(
      values,
    );
  });

  it('leaves a quote that is the id, or that reads like a provenance entry', async () => {
    const reference = { quote: source };
    const note = { quote: `{"entity_id": "${source}"}` };
    const { provenance } = await rewritten({
      provenance: { reference, note, issuer: entry(source) },
    });
    expect(provenance).toEqual({ reference, note, issuer: entry(target) });
  });

  it('leaves the documents of other entities alone', async () => {
    const before = await insertSyntheticDocument(database.db, {
      provenance: { issuer: entry(other) },
    });
    await rewrite();
    const [after] = await database.db.select().from(documents).where(eq(documents.id, before.id));
    expect(after).toEqual(before);
  });

  it('rewrites the entities of a fact, in place', async () => {
    expect(await factAbout([other, source])).toEqual([other, target]);
    expect(await factAbout([source, other])).toEqual([target, other]);
  });

  it('names the target once in a fact about both entities', async () => {
    expect(await factAbout([source, other, target])).toEqual([target, other]);
    expect(await factAbout([target, other, source])).toEqual([target, other]);
  });

  it('leaves the facts of other entities alone', async () => {
    expect(await factAbout([other, target])).toEqual([other, target]);
  });

  it('moves a pending merge proposal about the source onto the target', async () => {
    expect(await changeAbout({ source_id: other, target_id: source })).toEqual({
      source_id: other,
      target_id: target,
    });
    expect(await changeAbout({ source_id: source, target_id: other })).toEqual({
      source_id: target,
      target_id: other,
    });
  });

  it('leaves the proposal of this very merge as written, in either direction', async () => {
    const same = { source_id: source, target_id: target };
    const reverse = { source_id: target, target_id: source };
    expect(await changeAbout(same)).toEqual(same);
    expect(await changeAbout(reverse)).toEqual(reverse);
  });

  it('moves a rejected proposal about the source onto the target, so the refusal follows', async () => {
    expect(await changeAbout({ source_id: other, target_id: source }, 'rejected')).toEqual({
      source_id: other,
      target_id: target,
    });
  });

  it('leaves a proposal that was applied', async () => {
    const payload = { source_id: other, target_id: source };
    expect(await changeAbout(payload, 'applied')).toEqual(payload);
  });

  it('leaves a change of another kind', async () => {
    const payload = { source_id: other, target_id: source };
    expect(await changeAbout(payload, 'pending', 'merge_subject')).toEqual(payload);
  });
});
