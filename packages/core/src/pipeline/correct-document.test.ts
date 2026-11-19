import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { documentPages, documents } from '../db/schema/documents.ts';
import { documentDates } from '../db/schema/knowledge.ts';
import { jobs } from '../db/schema/jobs.ts';
import { entities } from '../db/schema/registry.ts';
import {
  MANUAL_PROVENANCE,
  MANUAL_TYPE_FIELD,
  PIPELINE_PROVENANCE_KEY,
} from '../domain/provenance.ts';
import { deleteDocument } from '../ingest/delete-document.ts';
import { upcoming } from '../knowledge/upcoming.ts';
import { createType } from '../registry/create-type.ts';
import { createGate } from '../testing/async.ts';
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

  // `get_status` and the document answer `updated_at`: a correction is a change a
  // caller polling the status sees there.
  it('moves the update time of the document', async () => {
    const type = await bill();
    const before = new Date('2026-01-01T00:00:00.000Z');
    const id = await settled(type.id, { updatedAt: before });
    await correctDocument(harness.deps(), { id, core: { reference: 'SYN-2' } });
    expect((await harness.document(id)).updatedAt.getTime()).toBeGreaterThan(before.getTime());
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
    [
      'a key date of an unknown kind',
      { core: { key_dates: [{ kind: 'birthday', date: '2027-03-01', label: 'x' }] } },
      'invalid_value',
    ],
    [
      'a key date with a blank label',
      { core: { key_dates: [{ kind: 'due', date: '2027-03-01', label: '  ' }] } },
      'invalid_value',
    ],
    [
      'one key date twice',
      {
        core: {
          key_dates: [
            { kind: 'due', date: '2027-03-01', label: 'Due' },
            { kind: 'due', date: '2027-03-01', label: 'Due again' },
          ],
        },
      },
      'invalid_value',
    ],
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

  describe('key dates', () => {
    const TWO_MONTHS = { amount: 2, unit: 'months', confidence: 0.8 };
    const STATUTORY_END = { kind: 'due', date: '2109-06-28', label: 'Statutory end' };
    const SITUATION = { kind: 'event', date: '2026-05-04', label: 'Situation date' };
    const RENEWAL = { kind: 'renewal', date: '2027-03-01', label: 'Renewal' };

    // A certificate whose extraction read the statutory end of a company as a due date.
    const certificate = async (overrides = {}): Promise<string> => {
      const type = await bill();
      const id = await settled(type.id, {
        core: { reference: 'SYN-1', key_dates: [STATUTORY_END] },
        provenance: { reference: EXTRACTED, key_dates: [EXTRACTED] },
        ...overrides,
      });
      await harness.db.insert(documentDates).values({
        documentId: id,
        ...STATUTORY_END,
        kind: 'due',
        model: 'm',
        schemaVersion: 1,
        page: 1,
        quote: 'q',
        confidence: 0.9,
      });
      return id;
    };

    const rowsOf = async (id: string) =>
      (await harness.db.select().from(documentDates).where(eq(documentDates.documentId, id)))
        .map(({ kind, date, label, model, quote, confidence, manual }) => ({
          kind,
          date,
          label,
          model,
          quote,
          confidence,
          manual,
        }))
        .sort((a, b) => a.date.localeCompare(b.date));

    const given = (keyDate: { kind: string; date: string; label: string }) => ({
      ...keyDate,
      model: null,
      quote: null,
      confidence: null,
      manual: true,
    });

    it('replaces them in the core and in `document_dates`, computing the notice deadline', async () => {
      const id = await certificate({ noticePeriod: TWO_MONTHS });
      const result = await correctDocument(harness.deps(), {
        id,
        core: { key_dates: [SITUATION, { ...RENEWAL, label: '  Renewal ' }] },
      });
      expect(result).toMatchObject({ ok: true });
      const document = await harness.document(id);
      expect(document.core.key_dates).toEqual([SITUATION, RENEWAL]);
      expect(document.provenance.key_dates).toEqual([MANUAL_PROVENANCE, MANUAL_PROVENANCE]);
      expect(document.manualFields).toEqual(['key_dates']);
      expect(document.status).toBe('indexed');
      expect(await rowsOf(id)).toEqual([
        given(SITUATION),
        {
          kind: 'notice_deadline',
          date: '2027-01-01',
          label: 'Notice deadline: 2 months before Renewal',
          model: null,
          quote: null,
          confidence: 0.8,
          manual: false,
        },
        given(RENEWAL),
      ]);
    });

    it('clears them in the core and in `document_dates`', async () => {
      const id = await certificate();
      expect(
        await correctDocument(harness.deps(), { id, core: { key_dates: null } }),
      ).toMatchObject({ ok: true });
      const document = await harness.document(id);
      expect(document.core).toEqual({ reference: 'SYN-1' });
      expect(document.provenance).not.toHaveProperty('key_dates');
      expect(document.manualFields).toEqual(['key_dates']);
      expect(await rowsOf(id)).toEqual([]);
    });

    it('leaves `document_dates` alone when the key dates are not corrected', async () => {
      const id = await certificate();
      const before = await rowsOf(id);
      await correctDocument(harness.deps(), { id, core: { reference: 'SYN-2' } });
      expect(await rowsOf(id)).toEqual(before);
    });

    it('answers `upcoming` with the dates of the core', async () => {
      const id = await certificate({ noticePeriod: TWO_MONTHS });
      await correctDocument(harness.deps(), { id, core: { key_dates: [SITUATION, RENEWAL] } });
      const { dates } = await upcoming(
        { db: harness.db },
        { from: '2026-01-01', to: '2110-12-31', includePrivate: true },
      );
      expect(
        dates.map(({ kind, date, label, computed }) => ({ kind, date, label, computed })),
      ).toEqual([
        { ...SITUATION, computed: false },
        {
          kind: 'notice_deadline',
          date: '2027-01-01',
          label: 'Notice deadline: 2 months before Renewal',
          computed: true,
        },
        { ...RENEWAL, computed: false },
      ]);
      const { core } = await harness.document(id);
      const typed = dates.filter(({ computed }) => !computed);
      expect(typed.map(({ kind, date, label }) => ({ kind, date, label }))).toEqual(core.key_dates);
    });

    it('refuses a notice deadline the renewal date and the notice period compute', async () => {
      const id = await certificate({ noticePeriod: TWO_MONTHS });
      const before = await harness.document(id);
      const typed = { kind: 'notice_deadline', date: '2027-02-01', label: 'Notice' };
      const result = await correctDocument(harness.deps(), {
        id,
        core: { key_dates: [RENEWAL, typed] },
      });
      expect(result).toMatchObject({
        ok: false,
        errors: [{ code: 'invalid_value', field: 'key_dates' }],
      });
      expect(await harness.document(id)).toEqual(before);
    });

    it('keeps a notice deadline a person gives when nothing computes one', async () => {
      const id = await certificate();
      const typed = { kind: 'notice_deadline', date: '2027-02-01', label: 'Notice' };
      await correctDocument(harness.deps(), { id, core: { key_dates: [RENEWAL, typed] } });
      expect(await rowsOf(id)).toEqual([given(typed), given(RENEWAL)]);
    });

    it('stays the same in the core and `document_dates` after a re-extraction', async () => {
      const id = await certificate();
      await correctDocument(harness.deps(), { id, core: { key_dates: [SITUATION, RENEWAL] } });
      const text = 'Statutory end 28/06/2109.\nNotice period: 1 month.';
      await harness.db.insert(documentPages).values({ documentId: id, page: 1, text });
      const reextracting = scriptedModel({
        extract: () => ({
          core: {
            key_dates: [
              { value: STATUTORY_END, page: 1, quote: 'Statutory end 28/06/2109', confidence: 0.9 },
            ],
          },
          fields: {},
          extra: {},
          notice_period: {
            amount: 1,
            unit: 'months',
            page: 1,
            quote: 'Notice period: 1 month',
            confidence: 0.7,
          },
        }),
      });
      await reextractDocument(harness.deps({ textModel: reextracting }), id, live());
      const document = await harness.document(id);
      expect(document.core.key_dates).toEqual([SITUATION, RENEWAL]);
      expect(document.provenance.key_dates).toEqual([MANUAL_PROVENANCE, MANUAL_PROVENANCE]);
      expect(document.noticePeriod).toEqual({ amount: 1, unit: 'months', confidence: 0.7 });
      // The dates a person gave stand; the notice period read again computes their deadline.
      expect(await rowsOf(id)).toEqual([
        given(SITUATION),
        {
          kind: 'notice_deadline',
          date: '2027-02-01',
          label: 'Notice deadline: 1 month before Renewal',
          model: null,
          quote: null,
          confidence: 0.7,
          manual: false,
        },
        given(RENEWAL),
      ]);
    });
  });

  describe('confirm', () => {
    it('keeps a confirmed value untouched, makes it manual and clears the flag', async () => {
      const type = await bill();
      const id = await settled(type.id, {
        core: { reference: 'SYN-1', issuer: 'Old Issuer' },
        fields: { meter_id: SYNTHETIC_IBAN_MASKED, parties: ['Old Issuer', 'Jane Synthetic'] },
        provenance: {
          reference: EXTRACTED,
          issuer: { entity_id: 'ent_OLD', match: 'created', confidence: 1 },
          meter_id: EXTRACTED,
          parties: [
            { entity_id: 'ent_OLD', match: 'created', confidence: 1 },
            { entity_id: 'ent_JANE', match: 'alias', confidence: 0.8 },
          ],
          [PIPELINE_PROVENANCE_KEY]: { type: { model: 'm', confidence: 0.4, outcome: 'existing' } },
        },
      });
      const before = await harness.document(id);
      const result = await correctDocument(harness.deps(), {
        id,
        confirm: {
          issuer: 'Old Issuer',
          meter_id: SYNTHETIC_IBAN_MASKED,
          parties: ['Old Issuer', 'Jane Synthetic'],
        },
      });
      const document = await harness.document(id);
      expect(result).toMatchObject({ ok: true, value: { status: 'indexed' } });
      expect(document).toMatchObject({
        status: 'indexed',
        core: before.core,
        fields: before.fields,
        manualFields: ['issuer', 'meter_id', 'parties'],
      });
      expect(document.provenance).toMatchObject({
        reference: EXTRACTED,
        issuer: { entity_id: 'ent_OLD', match: 'created', confidence: 1, manual: true },
        meter_id: MANUAL_PROVENANCE,
        parties: [
          { entity_id: 'ent_OLD', match: 'created', confidence: 1, manual: true },
          { entity_id: 'ent_JANE', match: 'alias', confidence: 0.8, manual: true },
        ],
      });
      expect(await harness.db.select().from(entities)).toEqual([]);
      expect(await queued()).toEqual([{ kind: 'reindex_document', payload: { documentId: id } }]);
    });

    it('confirms alongside a correction of other values and of the type it has', async () => {
      const type = await bill();
      const id = await settled(type.id);
      await correctDocument(harness.deps(), {
        id,
        type: 'energy_bill',
        core: { reference: 'SYN-2' },
        confirm: { meter_id: 'PDL-1' },
      });
      const document = await harness.document(id);
      expect(document).toMatchObject({
        status: 'indexed',
        core: { reference: 'SYN-2', issuer: 'Old Issuer' },
        fields: { meter_id: 'PDL-1' },
        manualFields: ['reference', 'meter_id', MANUAL_TYPE_FIELD],
      });
      expect(document.provenance).toMatchObject({
        reference: MANUAL_PROVENANCE,
        meter_id: MANUAL_PROVENANCE,
        issuer: { entity_id: 'ent_OLD' },
      });
    });

    it.each([
      ['a name without a value', { confirm: { due_date: '2026-10-18' } }, 'unknown_field'],
      ['key dates', { confirm: { key_dates: [] } }, 'unsupported_field'],
      ['a value other than the one stored', { confirm: { reference: 'SYN-9' } }, 'value_changed'],
      [
        'a name the request also sets',
        { core: { reference: 'SYN-2' }, confirm: { reference: 'SYN-1' } },
        'invalid_input',
      ],
      [
        'a name the request also clears',
        { fields: { meter_id: null }, confirm: { meter_id: 'PDL-1' } },
        'invalid_input',
      ],
    ])('refuses %s and writes nothing', async (_case, patch, code) => {
      const type = await bill();
      const id = await settled(type.id);
      const before = await harness.document(id);
      const result = await correctDocument(harness.deps(), { id, ...patch });
      expect(result).toMatchObject({ ok: false, errors: [{ code }] });
      expect(await harness.document(id)).toEqual(before);
      expect(await queued()).toEqual([]);
    });

    it('refuses a stale confirmation before resolving the names of the correction', async () => {
      const type = await bill();
      const id = await settled(type.id);
      const result = await correctDocument(harness.deps(), {
        id,
        core: { issuer: 'Brand New Synthetic Co' },
        confirm: { reference: 'SYN-9' },
      });
      expect(result).toMatchObject({ ok: false, errors: [{ code: 'value_changed' }] });
      expect(await harness.db.select().from(entities)).toEqual([]);
    });

    // Between the read the confirmation is planned on and the write, another writer (a
    // re-extraction) changes the value: the person never saw the new one.
    it.each([
      ['changes', { reference: 'SYN-EXTRACTED-AGAIN' }],
      ['disappears', {}],
    ])(
      'refuses a confirmed value that %s before the write, and writes nothing',
      async (_case, core) => {
        const type = await bill();
        const id = await settled(type.id);
        const planned = createGate();
        const changed = createGate();
        const interleaved: typeof harness.entities = {
          ...harness.entities,
          withLock: async (executor, work) => {
            planned.open();
            await changed.opened;
            return harness.entities.withLock(executor, work);
          },
        };
        const correcting = correctDocument(harness.deps({ entities: interleaved }), {
          id,
          confirm: { reference: 'SYN-1' },
        });
        await planned.opened;
        await harness.db
          .update(documents)
          .set({ core: { ...core, issuer: 'Old Issuer' } })
          .where(eq(documents.id, id));
        const before = await harness.document(id);
        changed.open();
        expect(await correcting).toMatchObject({
          ok: false,
          errors: [{ code: 'value_changed' }],
        });
        expect(await harness.document(id)).toEqual(before);
        expect(await queued()).toEqual([]);
      },
    );
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

  it('runs the privacy hook in its transaction only when the flag changes', async () => {
    const type = await bill();
    const id = await settled(type.id);
    const hooked: { readonly id: string; readonly private: boolean | undefined }[] = [];
    const deps = harness.deps({
      onPrivacyChanged: async (tx, documentId) => {
        // Read in the transaction: the flag it follows is already written there.
        const [row] = await tx
          .select({ private: documents.private })
          .from(documents)
          .where(eq(documents.id, documentId));
        hooked.push({ id: documentId, private: row?.private });
      },
    });
    await correctDocument(deps, { id, core: { reference: 'SYN-2' } });
    await correctDocument(deps, { id, private: false });
    expect(hooked).toEqual([]);
    await correctDocument(deps, { id, private: true });
    await correctDocument(deps, { id, private: true });
    await correctDocument(deps, { id, private: false });
    expect(hooked).toEqual([
      { id, private: true },
      { id, private: false },
    ]);
  });

  it('leaves the flag as it was when the privacy hook fails', async () => {
    const id = await harness.ingest('hook down');
    const deps = harness.deps({
      onPrivacyChanged: () => Promise.reject(new Error('the queue is down')),
    });
    await expect(correctDocument(deps, { id, private: true })).rejects.toThrow('the queue is down');
    expect(await harness.document(id)).toMatchObject({ status: 'received', private: false });
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
