import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { documentPages, documents } from '../db/schema/documents.ts';
import { documentDates, facts } from '../db/schema/knowledge.ts';
import { entities } from '../db/schema/registry.ts';
import { MANUAL_PROVENANCE, PIPELINE_PROVENANCE_KEY } from '../domain/provenance.ts';
import { createType } from '../registry/create-type.ts';
import { addField, renameField } from '../registry/field-operations.ts';
import { markMerged } from '../registry/lifecycle.ts';
import { createFakeEmbedder } from '../testing/fake-embedder.ts';
import { createFakeTextModel } from '../testing/fake-text-model.ts';
import { insertSyntheticDocument } from '../testing/fixtures.ts';
import { correctDocument } from './correct-document.ts';
import type { PipelineDeps } from './deps.ts';
import { PipelineConflictError } from './errors.ts';
import { extractDocument } from './extraction-stage.ts';
import { createPipelineHarness, live, type PipelineHarness } from './harness.test-helper.ts';
import { processDocument, reextractDocument } from './process-document.ts';

const PAGE_ONE =
  'Synthetic Energy SA\nInvoice SYN-2026-001\nTotal 84,20 EUR\nMeter PDL-000123\n350 kWh';
const PAGE_TWO = 'Second page with the tariff blue';

const at = (value: unknown, quote: string, confidence = 0.9) => ({
  value,
  page: 1,
  quote,
  confidence,
});

const FIRST = {
  title: 'Synthetic bill',
  core: {
    issuer: at('Synthetic Energy SA', 'Synthetic Energy SA'),
    reference: at('SYN-2026-001', 'Invoice SYN-2026-001'),
  },
  fields: { meter_id: at('PDL-000123', 'Meter PDL-000123') },
  extra: { usage: at(350, '350 kWh') },
  facts: [
    {
      text: 'Invoice SYN-2026-001 was issued.',
      page: 1,
      quote: 'Invoice SYN-2026-001',
      confidence: 0.9,
    },
  ],
};

describe('extraction and re-extraction', () => {
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

  const registry = () => ({
    db: harness.db,
    embedder: createFakeEmbedder(),
    maxNewTypesPerDay: 100,
    schemaLanguage: 'en' as const,
  });

  const seedType = async (slug = 'energy_bill') => {
    const created = await createType(
      { slug, description: `Synthetic ${slug}`, fields: { meter_id: { type: 'identifier' } } },
      registry(),
    );
    if (!created.ok) throw new Error(created.error.message);
    return created.value;
  };

  // A document as the classification stage leaves it.
  const classified = async (typeId: string | null, overrides = {}): Promise<string> => {
    const { id } = await insertSyntheticDocument(harness.db, {
      status: 'classified',
      typeId,
      provenance: {
        [PIPELINE_PROVENANCE_KEY]: {
          type: { model: 'classifier', confidence: 0.95, outcome: 'existing' },
        },
      },
      ...overrides,
    });
    await harness.db.insert(documentPages).values([
      { documentId: id, page: 1, text: PAGE_ONE },
      { documentId: id, page: 2, text: PAGE_TWO },
    ]);
    return id;
  };

  const model = (answer: (call: number) => unknown, name = 'fake-text-model') => {
    let calls = 0;
    return createFakeTextModel(() => {
      calls += 1;
      return answer(calls);
    }, name);
  };

  const indexed = async (
    typeId: string,
    overrides: Partial<PipelineDeps> = {},
  ): Promise<string> => {
    const id = await classified(typeId);
    await processDocument(
      harness.deps({ textModel: model(() => FIRST), ...overrides }),
      id,
      live(),
    );
    return id;
  };

  it('extracts again from the stored text with the current schema, in one text call', async () => {
    const type = await seedType();
    const id = await indexed(type.id);
    await addField(type.id, 'tariff', { type: 'text' }, { db: harness.db });
    const second = model(
      () => ({
        ...FIRST,
        core: { ...FIRST.core, reference: at('SYN-2026-001', 'Invoice SYN-2026-001', 0.5) },
        fields: {
          meter_id: at('PDL-000123', 'PDL-000123'),
          tariff: { ...at('blue', 'tariff blue'), page: 2 },
        },
        extra: { usage: at(84.2, 'Total 84,20 EUR') },
        facts: [
          { text: 'The total is 84,20 EUR.', page: 1, quote: 'Total 84,20 EUR', confidence: 0.9 },
        ],
      }),
      'second-model',
    );
    await reextractDocument(
      harness.deps({
        textModel: second,
        extractText: () => Promise.reject(new Error('the file must not be read again')),
        visionModel: { transcribePage: () => Promise.reject(new Error('no vision call')) },
      }),
      id,
      live(),
    );
    const document = await harness.document(id);
    expect(second.calls).toHaveLength(1);
    expect(second.calls[0]?.prompt).toContain('- tariff: text');
    expect(document).toMatchObject({
      status: 'indexed',
      schemaVersion: 2,
      fields: { meter_id: 'PDL-000123', tariff: 'blue' },
      extra: { usage: 84.2 },
    });
    // Unchanged values keep the provenance they had; the others get the new one.
    expect(document.provenance.meter_id).toMatchObject({
      model: 'fake-text-model',
      schema_version: 1,
      quote: 'Meter PDL-000123',
    });
    expect(document.provenance.reference).toMatchObject({
      model: 'fake-text-model',
      confidence: 0.9,
    });
    expect(document.provenance.tariff).toMatchObject({
      model: 'second-model',
      schema_version: 2,
      page: 2,
    });
    expect(document.provenance.usage).toMatchObject({ model: 'second-model' });
    expect((await harness.db.select().from(facts)).map(({ text }) => text)).toEqual([
      'The total is 84,20 EUR.',
    ]);
    expect(harness.indexed).toEqual([id, id]);
  });

  it('leaves a document that is not settled to process_document', async () => {
    const type = await seedType();
    const id = await classified(type.id);
    const silent = model(() => FIRST);
    await reextractDocument(harness.deps({ textModel: silent }), id, live());
    expect(silent.calls).toHaveLength(0);
    expect(harness.indexed).toEqual([]);
    expect(await harness.document(id)).toMatchObject({ status: 'classified', core: {} });
  });

  it('never writes over a field a person corrected, in either direction', async () => {
    const type = await seedType();
    const id = await indexed(type.id);
    const deps = harness.deps({ textModel: model(() => FIRST) });
    const corrected = await correctDocument(deps, {
      id,
      core: { reference: 'MANUAL-1', issuer: null },
      fields: { meter_id: 'MANUAL-METER' },
    });
    expect(corrected.ok).toBe(true);
    await reextractDocument(deps, id, live());
    const document = await harness.document(id);
    expect(document.core).toEqual({ reference: 'MANUAL-1' });
    expect(document.fields).toEqual({ meter_id: 'MANUAL-METER' });
    expect(document.provenance.reference).toEqual(MANUAL_PROVENANCE);
    expect(document.provenance.meter_id).toEqual(MANUAL_PROVENANCE);
    expect(document.provenance).not.toHaveProperty('issuer');
    // A corrected core value counts as certain.
    expect(document.confidence).toBeCloseTo(0.95, 5);
  });

  it('keeps a correction made while the model was answering', async () => {
    const type = await seedType();
    const id = await classified(type.id);
    const deps: PipelineDeps = harness.deps({
      textModel: model(() => FIRST),
    });
    const racing = harness.deps({
      textModel: createFakeTextModel(async () => {
        await correctDocument(deps, { id, core: { reference: 'MANUAL-1' } });
        return FIRST;
      }),
    });
    await processDocument(racing, id, live());
    const document = await harness.document(id);
    expect(document.core).toMatchObject({ reference: 'MANUAL-1', issuer: 'Synthetic Energy SA' });
    expect(document.provenance.reference).toEqual(MANUAL_PROVENANCE);
    expect(document.manualFields).toEqual(['reference']);
  });

  it('asks the model again when a field of the type was renamed during the call', async () => {
    const type = await seedType();
    const id = await classified(type.id);
    const racing = model((call) => {
      if (call > 1) return { ...FIRST, fields: { meter: at('PDL-000123', 'Meter PDL-000123') } };
      return renameField(type.id, 'meter_id', 'meter', { db: harness.db }).then(() => FIRST);
    });
    await processDocument(harness.deps({ textModel: racing }), id, live());
    expect(racing.calls).toHaveLength(2);
    expect(racing.calls[1]?.prompt).toContain('- meter: identifier');
    expect(await harness.document(id)).toMatchObject({
      schemaVersion: 2,
      fields: { meter: 'PDL-000123' },
      status: 'indexed',
    });
  });

  it('extracts for the target of a type merged meanwhile, and moves the document to it', async () => {
    const source = await seedType('power_bill');
    const target = await seedType('energy_bill');
    const id = await classified(source.id);
    await markMerged(source.id, target.id, { db: harness.db });
    const asked = model(() => FIRST);
    await processDocument(harness.deps({ textModel: asked }), id, live());
    expect(asked.calls[0]?.prompt).toContain('Type: energy_bill');
    expect(await harness.document(id)).toMatchObject({ typeId: target.id, status: 'indexed' });
  });

  it('resolves again, without a new model call, an entity merged away before the write', async () => {
    const type = await seedType();
    const id = await classified(type.id);
    const asked = model(() => FIRST);
    let checks = 0;
    const merging = {
      ...harness.entities,
      missingIds: async (...[tx, ids]: Parameters<typeof harness.entities.missingIds>) => {
        checks += 1;
        if (checks === 1) await tx.delete(entities);
        return harness.entities.missingIds(tx, ids);
      },
    };
    await processDocument(harness.deps({ textModel: asked, entities: merging }), id, live());
    const [entity] = await harness.db.select().from(entities);
    expect(asked.calls).toHaveLength(1);
    expect(harness.entities.mentions).toHaveLength(2);
    expect((await harness.document(id)).provenance.issuer).toMatchObject({ entity_id: entity?.id });
  });

  it('gives up with a retryable conflict when the result is stale at every attempt', async () => {
    const type = await seedType();
    const id = await classified(type.id);
    const never = { ...harness.entities, missingIds: () => Promise.resolve(['ent_GONE']) };
    await expect(
      processDocument(harness.deps({ textModel: model(() => FIRST), entities: never }), id, live()),
    ).rejects.toBeInstanceOf(PipelineConflictError);
    expect(harness.entities.mentions).toHaveLength(3);
    expect(await harness.document(id)).toMatchObject({
      status: 'classified',
      core: {},
      confidence: null,
    });
    expect(await harness.db.select().from(documentDates)).toEqual([]);
  });

  it('cuts a document longer than the budget, says so, and takes no quote from beyond the cut', async () => {
    const type = await seedType();
    const id = await classified(type.id);
    const deps = harness.deps();
    const asked = model(() => ({
      ...FIRST,
      extra: { tariff: { value: 'blue', page: 2, quote: 'tariff blue', confidence: 1 } },
    }));
    await processDocument(
      { ...deps, textModel: asked, settings: { ...deps.settings, maxExtractionTokens: 25 } },
      id,
      live(),
    );
    const document = await harness.document(id);
    expect(asked.calls[0]?.prompt).toContain('only its beginning is given');
    expect(asked.calls[0]?.prompt).toContain('[page 2]\nSecond page w');
    expect(asked.calls[0]?.prompt).not.toContain('the tariff blue');
    expect(document.extra).toEqual({});
    expect(document.provenance[PIPELINE_PROVENANCE_KEY]).toMatchObject({
      extraction: { truncated: true, rejected_values: 1 },
    });
  });

  it('forbids an external embedding of the entities of a private document', async () => {
    const type = await seedType();
    const id = await classified(type.id, { private: true });
    await processDocument(harness.deps({ textModel: model(() => FIRST) }), id, live());
    expect(harness.entities.options).toEqual([{ allowExternalEmbedding: false }]);
  });

  it('counts a rejected core value as a confidence of 0', async () => {
    const type = await seedType();
    const id = await classified(type.id);
    const output = {
      core: {
        reference: at('SYN-2026-001', 'Invoice SYN-2026-001', 1),
        due_date: at('2026-10-18', 'not in the text', 1),
      },
    };
    await processDocument(harness.deps({ textModel: model(() => output) }), id, live());
    expect(await harness.document(id)).toMatchObject({ confidence: 0.5, status: 'needs_review' });
  });

  it('extracts again for the type a person chose while the model was answering', async () => {
    const type = await seedType();
    const lease = await seedType('lease');
    const id = await classified(type.id);
    const deps = harness.deps();
    const racing = model((call) =>
      call > 1 ? FIRST : correctDocument(deps, { id, type: 'lease' }).then(() => FIRST),
    );
    await processDocument(harness.deps({ textModel: racing }), id, live());
    expect(racing.calls).toHaveLength(2);
    expect(racing.calls[1]?.prompt).toContain('Type: lease');
    expect(await harness.document(id)).toMatchObject({ typeId: lease.id, status: 'indexed' });
    // A type chosen by a person is certain: the confidence is the one of the core.
    expect((await harness.document(id)).confidence).toBeCloseTo(0.9, 5);
  });

  it('does not extract a classified document whose fields are already extracted', async () => {
    const type = await seedType();
    const id = await classified(type.id, { confidence: 0.8, title: 'Already extracted' });
    const silent = model(() => FIRST);
    expect(await extractDocument(harness.deps({ textModel: silent }), id, 'process', live())).toBe(
      false,
    );
    expect(silent.calls).toHaveLength(0);
    expect(await harness.document(id)).toMatchObject({ title: 'Already extracted', core: {} });
  });

  it('leaves a failed document alone', async () => {
    const type = await seedType();
    const id = await classified(type.id, { status: 'failed', error: 'no_text' });
    const silent = model(() => FIRST);
    await processDocument(harness.deps({ textModel: silent }), id, live());
    expect(silent.calls).toHaveLength(0);
    expect(await harness.document(id)).toMatchObject({ status: 'failed', error: 'no_text' });
  });

  // Verdict P7: the correction lands while the extracted document is being indexed.
  it('extracts for a type a person chose while the document was being indexed', async () => {
    await seedType();
    const water = await createType(
      {
        slug: 'water_bill',
        description: 'Bill from a water supplier',
        fields: { volume: { type: 'number' } },
      },
      registry(),
    );
    if (!water.ok) throw new Error(water.error.message);
    const type = await seedType('power_bill');
    const id = await classified(type.id);
    const asked = model((call) =>
      call === 1 ? FIRST : { ...FIRST, fields: { volume: at(350, '350 kWh') } },
    );
    let corrected = false;
    await processDocument(
      harness.deps({
        textModel: asked,
        indexDocument: async () => {
          if (corrected) return;
          corrected = true;
          const result = await correctDocument(harness.deps(), { id, type: 'water_bill' });
          if (!result.ok) throw new Error('the correction was refused');
        },
      }),
      id,
      live(),
    );
    expect(asked.calls).toHaveLength(2);
    expect(await harness.document(id)).toMatchObject({
      typeId: water.value.id,
      schemaVersion: water.value.version,
      fields: { volume: 350 },
      status: 'indexed',
    });
  });

  // Verdict P2: what a failed re-extraction leaves must still say an extraction is owed.
  it('keeps the owed extraction recorded when the re-extraction fails', async () => {
    const type = await seedType();
    await seedType('water_bill');
    const id = await indexed(type.id);
    await correctDocument(harness.deps(), { id, type: 'water_bill' });
    const failing = createFakeTextModel(() => {
      throw new Error('the model is down');
    });
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await expect(
        reextractDocument(harness.deps({ textModel: failing }), id, live()),
      ).rejects.toThrow('the model is down');
    }
    expect(await harness.document(id)).toMatchObject({ schemaVersion: null, confidence: null });
    // The next one that succeeds settles it, for the new type.
    await reextractDocument(harness.deps({ textModel: model(() => FIRST) }), id, live());
    expect(await harness.document(id)).toMatchObject({ schemaVersion: 1, status: 'indexed' });
    expect((await harness.document(id)).confidence).not.toBeNull();
  });

  // Each key date is one item of one core field: they weigh as one field in the mean.
  it('counts the key dates as one core field in the confidence', async () => {
    const type = await seedType();
    const id = await classified(type.id);
    const keyDate = (confidence: number) => ({
      value: { kind: 'due', date: '2026-10-18', label: 'Payment' },
      page: 2,
      quote: 'due 18/10/2026',
      confidence,
    });
    await harness.db
      .update(documentPages)
      .set({ text: `${PAGE_TWO}\ndue 18/10/2026` })
      .where(eq(documentPages.page, 2));
    const output = {
      core: {
        reference: at('SYN-2026-001', 'Invoice SYN-2026-001', 1),
        language: at('fr', 'Invoice SYN-2026-001', 1),
        key_dates: [keyDate(0.4), keyDate(0.4), keyDate(0.4)],
      },
    };
    await processDocument(harness.deps({ textModel: model(() => output) }), id, live());
    // Mean of 1, 1 and 0.4 over three fields, not of 1, 1, 0.4, 0.4 and 0.4.
    expect((await harness.document(id)).confidence).toBeCloseTo(0.8, 5);
  });

  it('fails a classified document that has no stored text', async () => {
    const { id } = await insertSyntheticDocument(harness.db, { status: 'classified' });
    await expect(processDocument(harness.deps(), id, live())).rejects.toMatchObject({
      code: 'no_text',
    });
    await harness.db.delete(documents).where(eq(documents.id, id));
  });
});
