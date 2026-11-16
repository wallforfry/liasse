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
import { createFakeEmbedder } from '../testing/fake-embedder.ts';
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
        maxNewTypesPerDay: 100,
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

  const settled = async (typeId: string | null, overrides = {}): Promise<string> => {
    const { id } = await insertSyntheticDocument(harness.db, {
      status: 'indexed',
      typeId,
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
    hint: null,
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
    it('queues a reclassification of the type the document has, with the hint cut', async () => {
      const { energy } = await seedTypes();
      const id = await settled(energy.id);
      const hint = `  ${'x'.repeat(MAX_HINT_LENGTH + 10)}`;
      expect(await requestReclassification(harness.db, id, { hint, newType: true })).toBe('queued');
      expect(await queued()).toEqual([
        {
          kind: 'reclassify_document',
          payload: payloadOf(id, energy.id, {
            hint: 'x'.repeat(MAX_HINT_LENGTH - 2),
            newType: true,
          }),
        },
      ]);
    });

    it('defaults to no hint and any type', async () => {
      const id = await settled(null, { status: 'needs_review' });
      expect(await requestReclassification(harness.db, id, { hint: '   ' })).toBe('queued');
      expect(await queued()).toEqual([
        { kind: 'reclassify_document', payload: payloadOf(id, null) },
      ]);
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
      const id = await settled(energy.id, { hint: 'uploaded as a bill' });
      const calls: FakeTextRequest[] = [];
      await reclassifyDocument(
        harness.deps({ textModel: choosing('water_bill', calls) }),
        payloadOf(id, energy.id, { hint: HINT }),
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
        fields: {},
        extra: { usage: 350, meter_id: 'PDL-1' },
        manualFields: ['reference'],
      });
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

    it('never lands on the rejected type through a new slug, and falls back to another', async () => {
      const { energy, water } = await seedTypes();
      const id = await settled(energy.id);
      const textModel = scriptedModel({
        classify: () => ({ ...NEW_TYPE, new_type: { ...NEW_TYPE.new_type, slug: 'energy_bill' } }),
      });
      await reclassifyDocument(harness.deps({ textModel }), payloadOf(id, energy.id), live());
      expect(textModel.calls.filter(isClassification)).toHaveLength(2);
      expect(textModel.calls[1]?.prompt).toContain('which a person said is wrong');
      expect(await harness.document(id)).toMatchObject({
        typeId: water.id,
        provenance: { [PIPELINE_PROVENANCE_KEY]: { type: { confidence: 0, outcome: 'fallback' } } },
      });
    });

    it('leaves the document untyped when no other type exists and none may be created', async () => {
      const { energy } = await seedTypes();
      await harness.db.delete(docTypes).where(eq(docTypes.slug, 'water_bill'));
      const id = await settled(energy.id, { private: true });
      const deps = harness.deps({
        textModel: scriptedModel({}),
        embedder: createFakeEmbedder({ isLocal: false }),
      });
      await reclassifyDocument(deps, payloadOf(id, energy.id), live());
      expect(await harness.document(id)).toMatchObject({
        typeId: null,
        fields: {},
        extra: { usage: 350, meter_id: 'PDL-1' },
        provenance: { [PIPELINE_PROVENANCE_KEY]: { type: { outcome: 'untyped' } } },
      });
      expect(await queued()).toEqual([{ kind: 'reextract_document', payload: { documentId: id } }]);
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
