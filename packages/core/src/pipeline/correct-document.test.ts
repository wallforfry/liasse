import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { documentPages, documents } from '../db/schema/documents.ts';
import { jobs } from '../db/schema/jobs.ts';
import { entities } from '../db/schema/registry.ts';
import {
  MANUAL_PROVENANCE,
  MANUAL_TYPE_FIELD,
  PIPELINE_PROVENANCE_KEY,
} from '../domain/provenance.ts';
import { deleteDocument } from '../ingest/delete-document.ts';
import { createType } from '../registry/create-type.ts';
import { createFakeEmbedder } from '../testing/fake-embedder.ts';
import { insertSyntheticDocument } from '../testing/fixtures.ts';
import { correctDocument } from './correct-document.ts';
import {
  createPipelineHarness,
  live,
  type PipelineHarness,
  scriptedModel,
  SYNTHETIC_IBAN,
  SYNTHETIC_IBAN_MASKED,
} from './harness.test-helper.ts';
import { reextractDocument } from './process-document.ts';

const EXTRACTED = { model: 'm', schema_version: 1, confidence: 0.9, page: 1, quote: 'q' };

describe('correctDocument', () => {
  let harness: PipelineHarness;

  beforeAll(async () => {
    harness = await createPipelineHarness();
  });

  afterEach(async () => {
    await harness.reset();
  });

  afterAll(async () => {
    await harness.dispose();
  });

  const seedType = async (slug: string, fields: Record<string, unknown>) => {
    const created = await createType(
      { slug, description: `Synthetic ${slug}`, fields },
      {
        db: harness.db,
        embedder: createFakeEmbedder(),
        maxNewTypesPerDay: 100,
        schemaLanguage: 'en',
      },
    );
    if (!created.ok) throw new Error(created.error.message);
    return created.value;
  };

  const bill = () =>
    seedType('energy_bill', {
      meter_id: { type: 'identifier' },
      broker: { type: 'entity' },
      parties: { type: 'list', items: { type: 'entity' } },
      tags: { type: 'list', items: { type: 'text' } },
    });

  const settled = async (typeId: string | null, overrides = {}): Promise<string> =>
    (
      await insertSyntheticDocument(harness.db, {
        status: 'needs_review',
        typeId,
        schemaVersion: typeId === null ? null : 1,
        confidence: 0.4,
        core: { reference: 'SYN-1', issuer: 'Old Issuer' },
        fields: { meter_id: 'PDL-1' },
        extra: { usage: 350 },
        provenance: {
          reference: EXTRACTED,
          issuer: { entity_id: 'ent_OLD', match: 'created', confidence: 1 },
          meter_id: EXTRACTED,
          usage: EXTRACTED,
          [PIPELINE_PROVENANCE_KEY]: { type: { model: 'm', confidence: 0.4, outcome: 'existing' } },
        },
        ...overrides,
      })
    ).id;

  const queued = async () =>
    (await harness.db.select().from(jobs)).map(({ kind, payload }) => ({ kind, payload }));

  it('writes the corrected values with a manual provenance and returns the document', async () => {
    const type = await bill();
    const id = await settled(type.id);
    const result = await correctDocument(harness.deps(), {
      id,
      core: { reference: 'SYN-2', due_date: '2026-10-18' },
      fields: { tags: ['a', 'b'] },
    });
    const document = await harness.document(id);
    expect(result).toMatchObject({
      ok: true,
      value: { id, core: document.core, status: 'indexed' },
    });
    expect(document).toMatchObject({
      status: 'indexed',
      core: { reference: 'SYN-2', due_date: '2026-10-18', issuer: 'Old Issuer' },
      fields: { meter_id: 'PDL-1', tags: ['a', 'b'] },
      extra: { usage: 350 },
      manualFields: ['due_date', 'reference', 'tags'],
    });
    expect(document.provenance).toMatchObject({
      reference: MANUAL_PROVENANCE,
      due_date: MANUAL_PROVENANCE,
      tags: [MANUAL_PROVENANCE, MANUAL_PROVENANCE],
      meter_id: EXTRACTED,
    });
    expect(await queued()).toEqual([{ kind: 'reindex_document', payload: { documentId: id } }]);
  });

  it('clears a field given as null and remembers it was cleared', async () => {
    const type = await bill();
    const id = await settled(type.id);
    await correctDocument(harness.deps(), {
      id,
      core: { reference: null },
      fields: { meter_id: null },
    });
    const document = await harness.document(id);
    expect(document.core).toEqual({ issuer: 'Old Issuer' });
    expect(document.fields).toEqual({});
    expect(document.manualFields).toEqual(['reference', 'meter_id']);
    expect(document.provenance).not.toHaveProperty('reference');
    expect(document.provenance).not.toHaveProperty('meter_id');
  });

  it('resolves corrected entity names again, one entry per item of a list', async () => {
    const type = await bill();
    const id = await settled(type.id);
    await correctDocument(harness.deps(), {
      id,
      core: { issuer: 'Synthetic Energy SA' },
      fields: { parties: ['Synthetic Energy SA', 'Jane Synthetic'], broker: 'Jane Synthetic' },
    });
    const { provenance } = await harness.document(id);
    const known = await harness.db.select().from(entities);
    const idOf = (name: string) => known.find(({ canonicalName }) => canonicalName === name)?.id;
    const energy = {
      entity_id: idOf('Synthetic Energy SA'),
      match: 'created',
      confidence: 1,
      manual: true,
    };
    const jane = {
      entity_id: idOf('Jane Synthetic'),
      match: 'created',
      confidence: 1,
      manual: true,
    };
    expect(known).toHaveLength(2);
    expect(provenance.issuer).toEqual(energy);
    expect(provenance.parties).toEqual([energy, jane]);
    expect(provenance.broker).toEqual(jane);
  });

  it('masks a sensitive identifier a person typed', async () => {
    const type = await bill();
    const id = await settled(type.id);
    await correctDocument(harness.deps(), {
      id,
      core: { reference: `pay ${SYNTHETIC_IBAN}` },
      fields: { meter_id: SYNTHETIC_IBAN },
    });
    expect(await harness.document(id)).toMatchObject({
      core: { reference: `pay ${SYNTHETIC_IBAN_MASKED}` },
      fields: { meter_id: SYNTHETIC_IBAN_MASKED },
    });
  });

  it.each([
    ['an unknown document', { id: 'doc_MISSING' }, 'document_not_found'],
    ['an unknown type', { type: 'no_such_type' }, 'type_not_found'],
    ['a value of the wrong primitive', { core: { due_date: 'tomorrow' } }, 'invalid_value'],
    ['an unknown core field', { core: { colour: 'blue' } }, 'invalid_value'],
    ['an unknown type field', { fields: { colour: 'blue' } }, 'unknown_field'],
    ['a wrong value of a type field', { fields: { tags: 'not a list' } }, 'invalid_value'],
    ['clearing a field that does not exist', { fields: { colour: null } }, 'unknown_field'],
    ['key dates', { core: { key_dates: [] } }, 'unsupported_field'],
    ['an entity the resolver refuses', { core: { issuer: 'x'.repeat(201) } }, 'unresolved_entity'],
    ['a key the operation does not have', { title: 'New title' }, 'invalid_input'],
  ])('refuses %s and writes nothing', async (_case, patch, code) => {
    const type = await bill();
    const id = await settled(type.id);
    const before = await harness.document(id);
    const result = await correctDocument(harness.deps(), { id, ...patch });
    expect(result).toMatchObject({ ok: false, errors: [{ code }] });
    expect(await harness.document(id)).toEqual(before);
    expect(await queued()).toEqual([]);
  });

  it('refuses fields for a document without a type', async () => {
    const id = await settled(null, { fields: {} });
    expect(await correctDocument(harness.deps(), { id, fields: { meter_id: 'x' } })).toMatchObject({
      ok: false,
      errors: [{ code: 'no_type' }],
    });
  });

  it('refuses a deleted document', async () => {
    const id = await harness.ingest('deleted');
    await deleteDocument({ db: harness.db }, id);
    expect(await correctDocument(harness.deps(), { id, private: true })).toMatchObject({
      ok: false,
      errors: [{ code: 'document_not_found' }],
    });
    expect(await harness.document(id)).toMatchObject({ status: 'deleted', private: false });
  });

  it('changes the type: the extraction it owes is recorded and queued', async () => {
    const type = await bill();
    const payslip = await seedType('payslip', {
      employer: { type: 'entity' },
      net_pay: { type: 'money' },
    });
    const id = await settled(type.id, { manualFields: ['reference'] });
    const result = await correctDocument(harness.deps(), {
      id,
      type: 'payslip',
      fields: { net_pay: { value: 1200, currency: 'EUR' } },
    });
    expect(result.ok).toBe(true);
    const document = await harness.document(id);
    expect(document).toMatchObject({
      typeId: payslip.id,
      // Until an extraction for the new type succeeds: behind its type, and unvouched.
      schemaVersion: null,
      confidence: null,
      fields: { net_pay: { value: 1200, currency: 'EUR' } },
      core: { reference: 'SYN-1' },
      manualFields: ['reference', 'net_pay', MANUAL_TYPE_FIELD],
    });
    expect(document.provenance[PIPELINE_PROVENANCE_KEY]).toEqual({ type: MANUAL_PROVENANCE });
    expect(await queued()).toEqual([{ kind: 'reextract_document', payload: { documentId: id } }]);
  });

  // Verdict R3: nothing is lost. A value a person set cannot come back from the text.
  it('moves the values of the old fields to `extra`, with their provenance and manual marks', async () => {
    const type = await bill();
    await seedType('water_bill', {
      volume: { type: 'number' },
      tags: { type: 'list', items: { type: 'text' } },
    });
    const id = await settled(type.id, {
      fields: { meter_id: 'MANUAL-METER', tags: ['kept'], broker: 'Synthetic Broker' },
      provenance: {
        meter_id: MANUAL_PROVENANCE,
        tags: [EXTRACTED],
        broker: { entity_id: 'ent_BROKER', match: 'created', confidence: 1 },
      },
      manualFields: ['meter_id'],
    });
    await correctDocument(harness.deps(), { id, type: 'water_bill' });
    const document = await harness.document(id);
    // A field of the new type with the same name and a valid value stays a field.
    expect(document.fields).toEqual({ tags: ['kept'] });
    expect(document.extra).toEqual({
      usage: 350,
      meter_id: 'MANUAL-METER',
      broker: 'Synthetic Broker',
    });
    expect(document.provenance).toMatchObject({
      meter_id: MANUAL_PROVENANCE,
      tags: [EXTRACTED],
      broker: { entity_id: 'ent_BROKER' },
    });
    expect(document.manualFields).toEqual(['meter_id', MANUAL_TYPE_FIELD]);
    // The re-extraction for the new type keeps the manual value; the text can give the
    // others back.
    await harness.db
      .insert(documentPages)
      .values({ documentId: id, page: 1, text: 'Volume 42 m3' });
    const reextracting = scriptedModel({
      extract: () => ({
        core: {},
        fields: { volume: { value: 42, page: 1, quote: 'Volume 42 m3', confidence: 0.9 } },
        extra: { meter_id: { value: '42', page: 1, quote: 'Volume 42 m3', confidence: 0.9 } },
      }),
    });
    await reextractDocument(harness.deps({ textModel: reextracting }), id, live());
    expect(await harness.document(id)).toMatchObject({
      fields: { volume: 42 },
      extra: { meter_id: 'MANUAL-METER' },
      provenance: { meter_id: MANUAL_PROVENANCE },
    });
  });

  // Verdict R1: only a correction of the type, the core or the fields is a review.
  it.each([
    ['an empty patch', {}],
    ['a patch of the private flag alone', { private: true }],
  ])('leaves a document flagged for review after %s', async (_case, patch) => {
    const type = await bill();
    const id = await settled(type.id, { error: 'reextraction_failed' });
    await correctDocument(harness.deps(), { id, ...patch });
    expect(await harness.document(id)).toMatchObject({
      status: 'needs_review',
      error: 'reextraction_failed',
    });
  });

  // An indexed document never carries the code of a re-extraction that failed: the
  // correction that clears the flag is the review of what that left.
  it('clears the code of a failed re-extraction with the flag it came with', async () => {
    const type = await bill();
    const id = await settled(type.id, { error: 'reextraction_failed' });
    await correctDocument(harness.deps(), { id, core: { reference: 'SYN-2' } });
    expect(await harness.document(id)).toMatchObject({ status: 'indexed', error: null });
  });

  it('marks a type a person confirmed as manual without touching the fields', async () => {
    const type = await bill();
    const id = await settled(type.id);
    await correctDocument(harness.deps(), { id, type: 'energy_bill' });
    expect(await harness.document(id)).toMatchObject({
      typeId: type.id,
      fields: { meter_id: 'PDL-1' },
      manualFields: [MANUAL_TYPE_FIELD],
    });
    expect(await queued()).toEqual([{ kind: 'reindex_document', payload: { documentId: id } }]);
  });

  it('flips `private`, queues a re-indexing and resolves entities without an external embedding', async () => {
    const type = await bill();
    const id = await settled(type.id);
    await correctDocument(harness.deps(), {
      id,
      private: true,
      core: { issuer: 'Private Issuer' },
    });
    expect(await harness.document(id)).toMatchObject({ private: true });
    expect(harness.entities.options).toEqual([{ allowExternalEmbedding: false }]);
    expect(await queued()).toEqual([{ kind: 'reindex_document', payload: { documentId: id } }]);
  });

  it('queues nothing for a document still on its way, which the pipeline will index', async () => {
    const type = await bill();
    const id = await settled(type.id, { status: 'extracted' });
    await correctDocument(harness.deps(), { id, type: 'energy_bill', private: true });
    expect(await harness.document(id)).toMatchObject({ status: 'extracted', private: true });
    expect(await queued()).toEqual([]);
  });

  it('resolves again when the entity was merged away before the write', async () => {
    const type = await bill();
    const id = await settled(type.id);
    // The entity resolved for the correction is gone by the time the lock is granted.
    let locks = 0;
    const merging: typeof harness.entities = {
      ...harness.entities,
      withLock: (executor, work) =>
        harness.entities.withLock(executor, async (tx) => {
          locks += 1;
          if (locks === 1) await tx.delete(entities);
          return work(tx);
        }),
    };
    const result = await correctDocument(harness.deps({ entities: merging }), {
      id,
      core: { issuer: 'Synthetic Energy SA' },
    });
    const [entity] = await harness.db.select().from(entities);
    expect(result.ok).toBe(true);
    expect(locks).toBe(2);
    expect((await harness.document(id)).provenance.issuer).toMatchObject({ entity_id: entity?.id });
  });

  it('leaves the status of a document that was not waiting for a review', async () => {
    const type = await bill();
    const id = await settled(type.id, { status: 'failed', error: 'no_text' });
    await correctDocument(harness.deps(), { id, core: { reference: 'SYN-2' } });
    expect(await harness.document(id)).toMatchObject({ status: 'failed', error: 'no_text' });
    await harness.db.delete(documents).where(eq(documents.id, id));
  });
});
