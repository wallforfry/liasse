import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { documentPages } from '../db/schema/documents.ts';
import { jobs } from '../db/schema/jobs.ts';
import { MANUAL_PROVENANCE, PIPELINE_PROVENANCE_KEY } from '../domain/provenance.ts';
import { createType } from '../registry/create-type.ts';
import { createFakeEmbedder } from '../testing/fake-embedder.ts';
import { createFakeTextModel } from '../testing/fake-text-model.ts';
import { insertSyntheticDocument } from '../testing/fixtures.ts';
import { createPipelineHarness, live, type PipelineHarness } from './harness.test-helper.ts';
import { reextractDocument } from './process-document.ts';
import { requestReextraction } from './request-reextraction.ts';

const PAGE = 'Synthetic Energy SA\nInvoice SYN-2026-002\nMeter PDL-000123';

const EXTRACTED = { model: 'm', schema_version: 1, confidence: 0.9, page: 1, quote: 'Invoice' };

const at = (value: unknown, quote: string) => ({ value, page: 1, quote, confidence: 0.9 });

describe('requestReextraction', () => {
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

  const settledBill = async (): Promise<{ id: string; typeId: string }> => {
    const created = await createType(
      {
        slug: 'energy_bill',
        description: 'Synthetic energy bill',
        fields: { meter_id: { type: 'identifier' } },
      },
      {
        db: harness.db,
        embedder: createFakeEmbedder(),
        maxNewTypesPerDay: 100,
        schemaLanguage: 'en',
      },
    );
    if (!created.ok) throw new Error(created.error.message);
    const { id } = await insertSyntheticDocument(harness.db, {
      status: 'needs_review',
      typeId: created.value.id,
      schemaVersion: 1,
      confidence: 0.4,
      core: { reference: 'SYN-WRONG' },
      fields: { meter_id: 'MANUAL-METER' },
      manualFields: ['meter_id'],
      provenance: {
        reference: EXTRACTED,
        meter_id: MANUAL_PROVENANCE,
        [PIPELINE_PROVENANCE_KEY]: {
          type: { model: 'classifier', confidence: 0.95, outcome: 'existing' },
        },
      },
    });
    await harness.db.insert(documentPages).values({ documentId: id, page: 1, text: PAGE });
    return { id, typeId: created.value.id };
  };

  it('queues a re-extraction that keeps the type and what a person corrected', async () => {
    const { id, typeId } = await settledBill();
    expect(await requestReextraction(harness.db, id)).toBe('queued');
    expect(
      (await harness.db.select().from(jobs)).map(({ kind, payload }) => ({ kind, payload })),
    ).toEqual([{ kind: 'reextract_document', payload: { documentId: id } }]);
    const textModel = createFakeTextModel(() => ({
      title: 'Synthetic bill',
      core: { reference: at('SYN-2026-002', 'Invoice SYN-2026-002') },
      fields: { meter_id: at('PDL-000123', 'Meter PDL-000123') },
      extra: {},
      facts: [],
    }));
    await reextractDocument(harness.deps({ textModel }), id, live());
    expect(textModel.calls).toHaveLength(1);
    const document = await harness.document(id);
    expect(document).toMatchObject({
      typeId,
      status: 'indexed',
      core: { reference: 'SYN-2026-002' },
      fields: { meter_id: 'MANUAL-METER' },
      manualFields: ['meter_id'],
    });
    expect(document.provenance.meter_id).toEqual(MANUAL_PROVENANCE);
  });

  it('refuses a document whose re-extraction is already pending', async () => {
    const { id } = await settledBill();
    expect(await requestReextraction(harness.db, id)).toBe('queued');
    expect(await requestReextraction(harness.db, id)).toBe('not_settled');
    expect(await harness.db.$count(jobs)).toBe(1);
  });
});
