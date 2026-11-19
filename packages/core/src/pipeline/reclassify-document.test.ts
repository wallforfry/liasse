import { MAX_HINT_LENGTH } from '@liasse/contract/domain';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { documentEvents } from '../db/schema/document-events.ts';
import { documentPages, documents } from '../db/schema/documents.ts';
import { jobs } from '../db/schema/jobs.ts';
import { docTypes } from '../db/schema/registry.ts';
import {
  MANUAL_PROVENANCE,
  MANUAL_TYPE_FIELD,
  PIPELINE_PROVENANCE_KEY,
} from '../domain/provenance.ts';
import { deleteDocument } from '../ingest/delete-document.ts';
import { enqueue } from '../jobs/enqueue.ts';
import { createType } from '../registry/create-type.ts';
import { columnsHolding } from '../testing/column-scan.ts';
import { createFakeEmbedder } from '../testing/fake-embedder.ts';
import { correctDocument } from './correct-document.ts';
import type { FakeTextRequest } from '../testing/fake-text-model.ts';
import { insertSyntheticDocument } from '../testing/fixtures.ts';
import {
  createPipelineHarness,
  isClassification,
  live,
  NEW_TYPE,
  type PipelineHarness,
  scriptedModel,
} from './harness.test-helper.ts';
import { PipelineConflictError } from './errors.ts';
import { reextractDocumentJob, type ReclassifyPayload } from './jobs.ts';
import { reextractDocument } from './process-document.ts';
import { reclassifyDocument } from './reclassify-document.ts';
import { requestReclassification } from './request-reclassification.ts';

const EXTRACTED = { model: 'm', schema_version: 1, confidence: 0.9, page: 1, quote: 'q' };
const PAGE = 'Synthetic Water Co\nInvoice SYN-2026-001\nVolume 42 m3';
const HINT = 'It is the water bill of the flat';

const delimited = (text: string): RegExp =>
  new RegExp(`<<<UNTRUSTED-DATA (\\w+)>>>\\n[^]*${text}[^]*\\n<<<END-UNTRUSTED-DATA \\1>>>`);

describe('reclassifying a document', () => {
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

  const seedTypes = async () => ({
    energy: await seedType('energy_bill', { meter_id: { type: 'identifier' } }),
    water: await seedType('water_bill', { volume: { type: 'number' } }),
  });

  // A typed document rejects its type, as the request of a reclassification leaves it.
  const settled = async (typeId: string | null, overrides = {}): Promise<string> => {
    const { id } = await insertSyntheticDocument(harness.db, {
      status: 'indexed',
      typeId,
      rejectedTypeIds: typeId === null ? [] : [typeId],
      schemaVersion: 1,
      confidence: 0.9,
      core: { reference: 'SYN-2026-001' },
      fields: { meter_id: 'PDL-1' },
      extra: { usage: 350 },
      provenance: {
        reference: MANUAL_PROVENANCE,
        meter_id: EXTRACTED,
        [PIPELINE_PROVENANCE_KEY]: { type: MANUAL_PROVENANCE },
      },
      manualFields: ['reference', MANUAL_TYPE_FIELD],
      ...overrides,
    });
    await harness.db.insert(documentPages).values({ documentId: id, page: 1, text: PAGE });
    return id;
  };

  const queued = async () =>
    (await harness.db.select().from(jobs)).map(({ kind, payload }) => ({ kind, payload }));

  const eventsOf = (id: string) =>
    harness.db.select().from(documentEvents).where(eq(documentEvents.documentId, id));

  const payloadOf = (
    documentId: string,
    rejectedTypeId: string | null,
    overrides: Partial<ReclassifyPayload> = {},
  ): ReclassifyPayload => ({
    documentId,
    rejectedTypeId,
    newType: false,
    ...overrides,
  });

  const choosing = (slug: string, calls: FakeTextRequest[] = []) =>
    scriptedModel({
      classify: (request) => {
        calls.push(request);
        return { decision: 'existing', slug, confidence: 0.9 };
      },
    });

  describe('the request', () => {
    it('queues a reclassification of the type the document has, its hint cut on the document', async () => {
      const { energy } = await seedTypes();
      const id = await settled(energy.id);
      const hint = `  ${'x'.repeat(MAX_HINT_LENGTH + 10)}`;
      expect(await requestReclassification(harness.db, id, { hint, newType: true })).toBe('queued');
      expect(await queued()).toEqual([
        { kind: 'reclassify_document', payload: payloadOf(id, energy.id, { newType: true }) },
      ]);
      expect(await harness.document(id)).toMatchObject({
        reclassificationHint: 'x'.repeat(MAX_HINT_LENGTH - 2),
      });
    });

    it('defaults to no hint, replacing the one of an earlier request, and any type', async () => {
      const id = await settled(null, { status: 'needs_review', reclassificationHint: HINT });
      expect(await requestReclassification(harness.db, id, { hint: '   ' })).toBe('queued');
      expect(await queued()).toEqual([
        { kind: 'reclassify_document', payload: payloadOf(id, null) },
      ]);
      expect(await harness.document(id)).toMatchObject({ reclassificationHint: null });
    });

    it('leaves nothing of the hint behind once the document is deleted', async () => {
      const { energy, water } = await seedTypes();
      const id = await settled(energy.id);
      expect(await requestReclassification(harness.db, id, { hint: HINT })).toBe('queued');
      await reclassifyDocument(
        harness.deps({ textModel: choosing('water_bill') }),
        payloadOf(id, energy.id),
        live(),
      );
      await harness.db.update(jobs).set({ status: 'succeeded' });
      expect(await harness.document(id)).toMatchObject({ typeId: water.id });
      expect(await columnsHolding(harness.db, HINT)).toEqual(['documents.reclassification_hint']);
      await deleteDocument({ db: harness.db }, id);
      expect(await columnsHolding(harness.db, HINT)).toEqual([]);
    });

    it('adds the rejected type to those of earlier requests, once, and none for an untyped one', async () => {
      const { energy, water } = await seedTypes();
      const id = await settled(energy.id, { rejectedTypeIds: [water.id] });
      expect(await requestReclassification(harness.db, id, {})).toBe('queued');
      expect(await harness.document(id)).toMatchObject({ rejectedTypeIds: [water.id, energy.id] });
      await harness.db.update(jobs).set({ status: 'succeeded' });
      expect(await requestReclassification(harness.db, id, {})).toBe('queued');
      expect(await harness.document(id)).toMatchObject({ rejectedTypeIds: [water.id, energy.id] });
      const untyped = await settled(null, { status: 'needs_review' });
      expect(await requestReclassification(harness.db, untyped, {})).toBe('queued');
      expect(await harness.document(untyped)).toMatchObject({ rejectedTypeIds: [] });
    });

    it.each(['received', 'classified', 'failed'] as const)(
      'refuses a document that is %s',
      async (status) => {
        const id = await settled(null, { status });
        expect(await requestReclassification(harness.db, id, {})).toBe('not_settled');
        expect(await queued()).toEqual([]);
      },
    );

    it('refuses a document whose type or fields a pending job is about to write', async () => {
      const id = await settled(null);
      await enqueue(harness.db, { kind: reextractDocumentJob, payload: { documentId: id } });
      expect(await requestReclassification(harness.db, id, {})).toBe('not_settled');
      await harness.db.update(jobs).set({ status: 'succeeded' });
      expect(await requestReclassification(harness.db, id, {})).toBe('queued');
      expect(await requestReclassification(harness.db, id, {})).toBe('not_settled');
    });

    it('answers not found for an unknown or deleted document', async () => {
      expect(await requestReclassification(harness.db, 'doc_01JC0000000000000000000000', {})).toBe(
        'not_found',
      );
      const id = await settled(null);
      await deleteDocument({ db: harness.db }, id);
      expect(await requestReclassification(harness.db, id, {})).toBe('not_found');
    });
  });

  describe('the job', () => {
    it('offers every candidate but the rejected type, and tells the model what the person said', async () => {
      const { energy } = await seedTypes();
      const id = await settled(energy.id, {
        hint: 'uploaded as a bill',
        reclassificationHint: HINT,
      });
      const calls: FakeTextRequest[] = [];
      await reclassifyDocument(
        harness.deps({ textModel: choosing('water_bill', calls) }),
        payloadOf(id, energy.id),
        live(),
      );
      const [request] = calls.filter(isClassification);
      if (request === undefined) throw new Error('The model was not asked');
      const answer = (slug: string) =>
        request.schema.safeParse({ decision: 'existing', slug, confidence: 0.9 }).success;
      expect(answer('energy_bill')).toBe(false);
      expect(answer('water_bill')).toBe(true);
      expect(request.prompt).toMatch(delimited('- energy_bill: Synthetic energy_bill'));
      expect(request.prompt).toMatch(delimited(HINT));
      expect(request.prompt).toMatch(delimited('uploaded as a bill'));
      expect(request.prompt).toContain('is not of the following type');
    });

    it('changes the type as a correction would, with the provenance of the model', async () => {
      const { energy, water } = await seedTypes();
      const id = await settled(energy.id);
      await reclassifyDocument(
        harness.deps({ textModel: choosing('water_bill') }),
        payloadOf(id, energy.id),
        live(),
      );
      const document = await harness.document(id);
      expect(document).toMatchObject({
        status: 'indexed',
        typeId: water.id,
        schemaVersion: null,
        confidence: null,
        core: { reference: 'SYN-2026-001' },
        extra: { usage: 350, meter_id: 'PDL-1' },
        manualFields: ['reference'],
      });
      expect(document.fields).toEqual({});
      expect(document.provenance).toMatchObject({
        reference: MANUAL_PROVENANCE,
        meter_id: EXTRACTED,
        [PIPELINE_PROVENANCE_KEY]: {
          type: { model: 'fake-text-model', confidence: 0.9, outcome: 'existing' },
        },
      });
      expect(await queued()).toEqual([{ kind: 'reextract_document', payload: { documentId: id } }]);
      expect(await eventsOf(id)).toEqual([
        expect.objectContaining({
          stage: 'classification',
          outcome: 'succeeded',
          status: 'indexed',
          model: 'fake-text-model',
          details: { classification: 'existing' },
        }),
      ]);
    });

    it('asks for a new type only, and creates it, when the person wants one', async () => {
      const { energy } = await seedTypes();
      const id = await settled(energy.id);
      const calls: FakeTextRequest[] = [];
      const textModel = scriptedModel({
        classify: (request) => {
          calls.push(request);
          return { ...NEW_TYPE, new_type: { ...NEW_TYPE.new_type, slug: 'gas_bill' } };
        },
      });
      await reclassifyDocument(
        harness.deps({ textModel }),
        payloadOf(id, energy.id, { newType: true }),
        live(),
      );
      const [request] = calls;
      expect(
        request?.schema.safeParse({ decision: 'existing', slug: 'water_bill', confidence: 0.9 })
          .success,
      ).toBe(false);
      expect(request?.prompt).toMatch(delimited('- water_bill: Synthetic water_bill'));
      expect(request?.prompt).toContain('asked for a new type');
      const [created] = await harness.db
        .select()
        .from(docTypes)
        .where(eq(docTypes.slug, 'gas_bill'));
      expect(await harness.document(id)).toMatchObject({ typeId: created?.id });
      expect((await eventsOf(id))[0]).toMatchObject({ details: { classification: 'new' } });
    });

    // Real use: a first import left most documents so, under a daily quota of new types
    // that is now removed; their stored refusal still parses.
    it('files a document the removed daily quota left untyped, under a new type', async () => {
      await seedTypes();
      const id = await settled(null, {
        status: 'needs_review',
        schemaVersion: null,
        confidence: 0,
        fields: {},
        extra: { meter_id: 'PDL-1' },
        provenance: {
          reference: EXTRACTED,
          [PIPELINE_PROVENANCE_KEY]: {
            type: { model: 'm', confidence: 0, outcome: 'untyped', refusal: 'quota_exceeded' },
          },
        },
        manualFields: [],
      });
      expect(await requestReclassification(harness.db, id, {})).toBe('queued');
      const [job] = await queued();
      expect(job).toEqual({ kind: 'reclassify_document', payload: payloadOf(id, null) });
      await harness.db.update(jobs).set({ status: 'succeeded' });
      const textModel = scriptedModel({
        classify: () => ({ ...NEW_TYPE, new_type: { ...NEW_TYPE.new_type, slug: 'gas_bill' } }),
      });
      await reclassifyDocument(harness.deps({ textModel }), payloadOf(id, null), live());
      const [created] = await harness.db
        .select()
        .from(docTypes)
        .where(eq(docTypes.slug, 'gas_bill'));
      const document = await harness.document(id);
      expect(document).toMatchObject({ typeId: created?.id });
      expect(document.provenance[PIPELINE_PROVENANCE_KEY]).toEqual({
        type: { model: 'fake-text-model', confidence: 0.9, outcome: 'new' },
      });
      expect((await eventsOf(id))[0]).toMatchObject({ details: { classification: 'new' } });
    });

    // The document as `settled` wrote it, and the one failed event that says why.
    const expectUnchanged = async (id: string, typeId: string, refusal: string) => {
      expect(await harness.document(id)).toMatchObject({
        typeId,
        status: 'indexed',
        confidence: 0.9,
        fields: { meter_id: 'PDL-1' },
        extra: { usage: 350 },
        provenance: { [PIPELINE_PROVENANCE_KEY]: { type: MANUAL_PROVENANCE } },
      });
      expect(await queued()).toEqual([]);
      expect(await eventsOf(id)).toEqual([
        expect.objectContaining({
          stage: 'classification',
          outcome: 'failed',
          status: 'indexed',
          errorCode: refusal,
          retryable: false,
          details: { classification: 'untyped', type_refusal: refusal },
        }),
      ]);
    };

    it('never lands on the rejected type through a new slug, nor on another type', async () => {
      const { energy } = await seedTypes();
      const id = await settled(energy.id);
      const textModel = scriptedModel({
        classify: () => ({ ...NEW_TYPE, new_type: { ...NEW_TYPE.new_type, slug: 'energy_bill' } }),
      });
      await reclassifyDocument(harness.deps({ textModel }), payloadOf(id, energy.id), live());
      expect(textModel.calls.filter(isClassification)).toHaveLength(2);
      expect(textModel.calls[1]?.prompt).toContain('which a person said is wrong');
      await expectUnchanged(id, energy.id, 'rejected_type');
    });

    it('keeps the document as it was when a new type may not be created', async () => {
      const { energy } = await seedTypes();
      const id = await settled(energy.id, { private: true });
      const deps = harness.deps({
        textModel: scriptedModel({}),
        embedder: createFakeEmbedder({ isLocal: false }),
      });
      await reclassifyDocument(deps, payloadOf(id, energy.id), live());
      await expectUnchanged(id, energy.id, 'private_document');
    });

    it('takes no existing type that a new slug names when a new type is required', async () => {
      const { energy } = await seedTypes();
      const id = await settled(energy.id);
      const textModel = scriptedModel({
        classify: () => ({ ...NEW_TYPE, new_type: { ...NEW_TYPE.new_type, slug: 'water_bill' } }),
      });
      await reclassifyDocument(
        harness.deps({ textModel }),
        payloadOf(id, energy.id, { newType: true }),
        live(),
      );
      expect(textModel.calls.filter(isClassification)).toHaveLength(2);
      expect(textModel.calls[1]?.prompt).toContain('A type with the slug "water_bill"');
      await expectUnchanged(id, energy.id, 'invalid_proposal');
    });

    describe('after earlier reclassifications', () => {
      const seedThreeTypes = async () => ({
        ...(await seedTypes()),
        gas: await seedType('gas_bill', { volume: { type: 'number' } }),
      });

      // The request, then its job with the model given, as a person clicking twice would.
      const reclassify = async (id: string, textModel: ReturnType<typeof choosing>) => {
        await harness.db.update(jobs).set({ status: 'succeeded' });
        expect(await requestReclassification(harness.db, id, {})).toBe('queued');
        const { typeId } = await harness.document(id);
        await reclassifyDocument(harness.deps({ textModel }), payloadOf(id, typeId), live());
      };

      // Real use: two requests in a row bounced between two wrong types, the second one
      // rejecting only the type the first one had decided.
      it('never offers again a type a person rejected for the document', async () => {
        const { energy, water, gas } = await seedThreeTypes();
        const id = await settled(energy.id);
        await reclassify(id, choosing('water_bill'));
        expect(await harness.document(id)).toMatchObject({ typeId: water.id });
        const calls: FakeTextRequest[] = [];
        await reclassify(id, choosing('gas_bill', calls));
        const [request] = calls.filter(isClassification);
        if (request === undefined) throw new Error('The model was not asked');
        const answer = (slug: string) =>
          request.schema.safeParse({ decision: 'existing', slug, confidence: 0.9 }).success;
        expect([answer('energy_bill'), answer('water_bill'), answer('gas_bill')]).toEqual([
          false,
          false,
          true,
        ]);
        expect(request.prompt).toContain('is not of the following types, which are');
        expect(request.prompt).toMatch(
          delimited('- energy_bill: Synthetic energy_bill\n- water_bill: Synthetic water_bill'),
        );
        expect(await harness.document(id)).toMatchObject({
          typeId: gas.id,
          rejectedTypeIds: [energy.id, water.id],
        });
      });

      it('never lands on an earlier rejected type through a new slug', async () => {
        const { energy, water } = await seedThreeTypes();
        const id = await settled(energy.id);
        await reclassify(id, choosing('water_bill'));
        await harness.db.delete(documentEvents);
        const textModel = scriptedModel({
          classify: () => ({
            ...NEW_TYPE,
            new_type: { ...NEW_TYPE.new_type, slug: 'energy_bill' },
          }),
        });
        await reclassify(id, textModel);
        expect(textModel.calls[1]?.prompt).toContain('"energy_bill", which a person said is wrong');
        expect(await harness.document(id)).toMatchObject({ typeId: water.id });
        expect(await eventsOf(id)).toEqual([
          expect.objectContaining({ outcome: 'failed', errorCode: 'rejected_type' }),
        ]);
      });

      it('forgets them once a person sets the type by hand, and not before', async () => {
        const { energy, water } = await seedThreeTypes();
        const id = await settled(energy.id);
        await reclassify(id, choosing('water_bill'));
        await harness.db.update(jobs).set({ status: 'succeeded' });
        await correctDocument(harness.deps(), { id, core: { reference: 'SYN-2' } });
        expect(await harness.document(id)).toMatchObject({ rejectedTypeIds: [energy.id] });
        await correctDocument(harness.deps(), { id, type: 'water_bill' });
        expect(await harness.document(id)).toMatchObject({ typeId: water.id, rejectedTypeIds: [] });
        await reclassify(id, choosing('energy_bill'));
        expect(await harness.document(id)).toMatchObject({
          typeId: energy.id,
          rejectedTypeIds: [water.id],
        });
      });
    });

    it('writes nothing when the type changed after the request', async () => {
      const { energy, water } = await seedTypes();
      const id = await settled(energy.id);
      await harness.db.update(documents).set({ typeId: water.id }).where(eq(documents.id, id));
      const textModel = choosing('water_bill');
      await reclassifyDocument(harness.deps({ textModel }), payloadOf(id, energy.id), live());
      expect(textModel.calls).toEqual([]);
      expect(await harness.document(id)).toMatchObject({ typeId: water.id, confidence: 0.9 });
      expect(await queued()).toEqual([]);
      expect(await eventsOf(id)).toEqual([]);
    });

    // A merge of a rejected type into the type the model decides rewrites the list, as
    // `rewriteRejectedTypes` does, while the model answers.
    it('writes nothing, and runs again, when the decided type becomes a rejected one', async () => {
      const { energy, water } = await seedTypes();
      const id = await settled(energy.id);
      const textModel = scriptedModel({
        classify: async () => {
          await harness.db
            .update(documents)
            .set({ rejectedTypeIds: [energy.id, water.id] })
            .where(eq(documents.id, id));
          return { decision: 'existing', slug: 'water_bill', confidence: 0.9 };
        },
      });
      await expect(
        reclassifyDocument(harness.deps({ textModel }), payloadOf(id, energy.id), live()),
      ).rejects.toBeInstanceOf(PipelineConflictError);
      expect(await harness.document(id)).toMatchObject({ typeId: energy.id, confidence: 0.9 });
      expect(await queued()).toEqual([]);
      expect(await eventsOf(id)).toEqual([]);
    });

    it('writes nothing when the type changes while the model answers', async () => {
      const { energy } = await seedTypes();
      const id = await settled(energy.id);
      const textModel = scriptedModel({
        classify: async () => {
          await harness.db.update(documents).set({ typeId: null }).where(eq(documents.id, id));
          return { decision: 'existing', slug: 'water_bill', confidence: 0.9 };
        },
      });
      await reclassifyDocument(harness.deps({ textModel }), payloadOf(id, energy.id), live());
      expect(await harness.document(id)).toMatchObject({ typeId: null, confidence: 0.9 });
      expect(await queued()).toEqual([]);
    });

    it('ends settled with the new type once the queued re-extraction ran', async () => {
      const { energy, water } = await seedTypes();
      const id = await settled(energy.id, { status: 'needs_review' });
      const textModel = scriptedModel({
        classify: () => ({ decision: 'existing', slug: 'water_bill', confidence: 0.95 }),
        extract: () => ({
          core: {
            reference: {
              value: 'SYN-2026-001',
              page: 1,
              quote: 'Invoice SYN-2026-001',
              confidence: 0.95,
            },
          },
          fields: { volume: { value: 42, page: 1, quote: 'Volume 42 m3', confidence: 0.95 } },
          extra: {},
        }),
      });
      const deps = harness.deps({ textModel });
      await reclassifyDocument(deps, payloadOf(id, energy.id), live());
      const [job] = await harness.db
        .select()
        .from(jobs)
        .where(and(eq(jobs.kind, 'reextract_document'), eq(jobs.status, 'queued')));
      expect(job?.payload).toEqual({ documentId: id });
      await reextractDocument(deps, id, live());
      expect(await harness.document(id)).toMatchObject({
        status: 'indexed',
        typeId: water.id,
        schemaVersion: water.version,
        fields: { volume: 42 },
        core: { reference: 'SYN-2026-001' },
      });
    });
  });
});
