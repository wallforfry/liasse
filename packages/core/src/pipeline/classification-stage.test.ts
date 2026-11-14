import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { documentPages, documents } from '../db/schema/documents.ts';
import { docTypes } from '../db/schema/registry.ts';
import { MANUAL_TYPE_FIELD, PIPELINE_PROVENANCE_KEY } from '../domain/provenance.ts';
import { createType } from '../registry/create-type.ts';
import { markMerged } from '../registry/lifecycle.ts';
import { createFakeEmbedder } from '../testing/fake-embedder.ts';
import type { FakeTextRequest } from '../testing/fake-text-model.ts';
import { insertSyntheticDocument } from '../testing/fixtures.ts';
import { runClassificationStage } from './classification-stage.ts';
import type { PipelineDeps } from './deps.ts';
import { loadDocument } from './document.ts';
import {
  createPipelineHarness,
  live,
  NEW_TYPE,
  pagesOf,
  type PipelineHarness,
  scriptedModel,
} from './harness.test-helper.ts';
import { processDocument } from './process-document.ts';

const TYPES = [
  ['energy_bill', 'Bill from an electricity or gas supplier for a home'],
  ['payslip', 'Monthly statement of the salary paid by an employer'],
  ['lease', 'Contract by which a landlord rents a home to a tenant'],
] as const;

const proposal = (slug: string, fields: unknown = {}) => ({
  ...NEW_TYPE,
  new_type: { ...NEW_TYPE.new_type, slug, fields },
});

describe('the classification stage', () => {
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

  const registryContext = () => ({
    db: harness.db,
    embedder: createFakeEmbedder(),
    maxNewTypesPerDay: 100,
    schemaLanguage: 'en' as const,
  });

  const seedTypes = async (): Promise<Readonly<Record<string, string>>> => {
    const ids: Record<string, string> = {};
    for (const [slug, description] of TYPES) {
      const created = await createType({ slug, description, fields: {} }, registryContext());
      if (!created.ok) throw new Error(created.error.message);
      ids[slug] = created.value.id;
    }
    return ids;
  };

  const classify = async (
    id: string,
    answers: (request: FakeTextRequest, call: number) => unknown,
    overrides: Partial<PipelineDeps> = {},
  ) => {
    const model = scriptedModel({ classify: answers });
    await processDocument(harness.deps({ textModel: model, ...overrides }), id, live());
    const document = await harness.document(id);
    return {
      document,
      type: document.provenance[PIPELINE_PROVENANCE_KEY],
      prompts: model.calls
        .filter(({ system }) => system.startsWith('You file'))
        .map(({ prompt }) => prompt),
    };
  };

  const text = (opening: string) => ({ extractText: () => Promise.resolve(pagesOf(opening)) });

  it('offers the closest types first, with their description and an example title', async () => {
    const ids = await seedTypes();
    await insertSyntheticDocument(harness.db, {
      typeId: ids.payslip,
      title: 'Synthetic payslip of March',
      status: 'indexed',
    });
    const id = await harness.ingest('payslip', 'my salary');
    const { document, type, prompts } = await classify(
      id,
      () => ({ decision: 'existing', slug: 'payslip', confidence: 0.93 }),
      text('Monthly statement of the salary paid by the employer Synthetic Works'),
    );
    expect(document.typeId).toBe(ids.payslip);
    expect(type).toMatchObject({
      type: { model: 'fake-text-model', confidence: 0.93, outcome: 'existing' },
    });
    const [prompt = ''] = prompts;
    expect(prompt.indexOf('- payslip:')).toBeLessThan(prompt.indexOf('- energy_bill:'));
    expect(prompt).toContain(
      '- payslip: Monthly statement of the salary paid by an employer (example: Synthetic payslip of March)',
    );
    expect(prompt).toContain('my salary');
    expect(prompts).toHaveLength(1);
  });

  it('refuses an answer that names a type which was not offered', async () => {
    await seedTypes();
    const id = await harness.ingest('not offered');
    await expect(
      classify(id, () => ({ decision: 'existing', slug: 'tax_notice', confidence: 0.9 })),
    ).rejects.toThrow('does not match the schema');
    expect(await harness.document(id)).toMatchObject({ status: 'extracted', typeId: null });
  });

  it('never sends the opening of a private document to an external embedder', async () => {
    const ids = await seedTypes();
    await insertSyntheticDocument(harness.db, { typeId: ids.lease, status: 'indexed' });
    await insertSyntheticDocument(harness.db, { typeId: ids.lease, status: 'indexed' });
    await insertSyntheticDocument(harness.db, { typeId: ids.payslip, status: 'indexed' });
    const id = await harness.ingest('private');
    await harness.db.update(documents).set({ private: true }).where(eq(documents.id, id));
    const embedded: string[] = [];
    const external = {
      ...createFakeEmbedder({ isLocal: false }),
      embed: (texts: readonly string[]) => {
        embedded.push(...texts);
        return createFakeEmbedder().embed(texts, 'query');
      },
    };
    const { prompts } = await classify(
      id,
      () => ({ decision: 'existing', slug: 'lease', confidence: 0.9 }),
      { embedder: external, ...text('Bill from an electricity supplier') },
    );
    expect(embedded).toEqual([]);
    // Without a similarity, the most used types come first, then the order of the slugs.
    const [prompt = ''] = prompts;
    const order = ['- lease:', '- payslip:', '- energy_bill:'].map((line) => prompt.indexOf(line));
    expect(order).toEqual([...order].sort((left, right) => left - right));
    expect(order.every((index) => index >= 0)).toBe(true);
  });

  it('does send the opening of a public document to an external embedder', async () => {
    await seedTypes();
    const id = await harness.ingest('public');
    const embedded: string[] = [];
    const external = {
      ...createFakeEmbedder({ isLocal: false }),
      embed: (texts: readonly string[]) => {
        embedded.push(...texts);
        return createFakeEmbedder().embed(texts, 'query');
      },
    };
    await classify(id, () => ({ decision: 'existing', slug: 'lease', confidence: 0.9 }), {
      embedder: external,
      ...text('Opening of a public document'),
    });
    expect(embedded).toEqual(['Opening of a public document']);
  });

  it('gives the model only the first 2,000 tokens of the document', async () => {
    const id = await harness.ingest('long');
    const { prompts } = await classify(id, () => NEW_TYPE, text(`${'a'.repeat(8000)}BEYOND`));
    expect(prompts[0]).toContain('a'.repeat(8000));
    expect(prompts[0]).not.toContain('aB');
  });

  it('creates the type the model proposes', async () => {
    const id = await harness.ingest('new type');
    const { document, type } = await classify(id, () => NEW_TYPE);
    const [created] = await harness.db.select().from(docTypes);
    expect(created).toMatchObject({ slug: 'energy_bill', status: 'provisional' });
    expect(document.typeId).toBe(created?.id);
    expect(type).toMatchObject({ type: { outcome: 'new', confidence: 0.9 } });
  });

  it('gives the refusal of the registry back to the model once, and takes its correction', async () => {
    const id = await harness.ingest('corrected');
    const { document, type, prompts } = await classify(id, (_request, call) =>
      call === 1 ? proposal('Energy Bill') : proposal('energy_bill'),
    );
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain('must be snake_case');
    expect(prompts[1]).toContain('"slug":"Energy Bill"');
    expect(document.typeId).not.toBeNull();
    expect(type).toMatchObject({ type: { outcome: 'new' } });
  });

  it('falls back to the closest candidate, for review, when the correction is refused too', async () => {
    const ids = await seedTypes();
    const id = await harness.ingest('refused twice');
    const { document, type, prompts } = await classify(
      id,
      () => proposal('edf_2026'),
      text('Monthly statement of the salary paid by an employer'),
    );
    expect(prompts).toHaveLength(2);
    expect(document).toMatchObject({ typeId: ids.payslip, status: 'needs_review' });
    expect(type).toMatchObject({ type: { outcome: 'fallback', confidence: 0 } });
    expect(await harness.db.select().from(docTypes)).toHaveLength(3);
  });

  it('falls back at once, without a second call, when the daily quota is reached', async () => {
    const ids = await seedTypes();
    const id = await harness.ingest('over quota');
    const deps = harness.deps();
    const { document, type, prompts } = await classify(id, () => proposal('tax_notice'), {
      settings: { ...deps.settings, maxNewTypesPerDay: 3, confidenceThreshold: 0 },
      ...text('Contract by which a landlord rents a home to a tenant'),
    });
    expect(prompts).toHaveLength(1);
    // Flagged for review whatever the threshold.
    expect(document).toMatchObject({ typeId: ids.lease, status: 'needs_review' });
    expect(type).toMatchObject({ type: { outcome: 'fallback' } });
  });

  it('leaves the document without a type, with the core only, when there is no candidate', async () => {
    const id = await harness.ingest('untyped');
    const deps = harness.deps();
    const model = scriptedModel({
      classify: () => proposal('tax_notice'),
      extract: () => ({
        core: {
          reference: { value: 'SYN-2026-001', page: 1, quote: 'SYN-2026-001', confidence: 1 },
        },
        fields: {
          stray: { value: 'SYN-2026-001', page: 1, quote: 'Invoice SYN-2026-001', confidence: 1 },
        },
      }),
    });
    await processDocument(
      { ...deps, textModel: model, settings: { ...deps.settings, maxNewTypesPerDay: 0 } },
      id,
      live(),
    );
    const document = await harness.document(id);
    expect(document).toMatchObject({
      typeId: null,
      schemaVersion: null,
      status: 'needs_review',
      core: { reference: 'SYN-2026-001' },
      fields: {},
      extra: { stray: 'SYN-2026-001' },
    });
    expect(document.provenance.reference).toMatchObject({ schema_version: null });
    expect(model.calls.at(-1)?.prompt).toContain('The document has no type');
  });

  it('uses the type that already holds the proposed name, even when it was not offered', async () => {
    const ids = await seedTypes();
    const merged = await createType(
      { slug: 'power_bill', description: 'Bill for electricity', fields: {} },
      registryContext(),
    );
    if (!merged.ok) throw new Error(merged.error.message);
    await markMerged(merged.value.id, ids.energy_bill ?? '', { db: harness.db });
    const id = await harness.ingest('known name');
    const { document, type, prompts } = await classify(id, () => proposal('power_bill'));
    expect(prompts).toHaveLength(1);
    expect(document.typeId).toBe(ids.energy_bill);
    expect(type).toMatchObject({ type: { outcome: 'existing', confidence: 0.9 } });
  });

  it('does not ask the model for a type a person chose, and keeps it', async () => {
    const ids = await seedTypes();
    const id = await harness.ingest('manual type');
    await harness.db
      .update(documents)
      .set({ typeId: ids.lease, manualFields: [MANUAL_TYPE_FIELD] })
      .where(eq(documents.id, id));
    const { document, prompts } = await classify(id, () => NEW_TYPE);
    expect(prompts).toEqual([]);
    expect(document.typeId).toBe(ids.lease);
  });

  it('puts the extraction back to do when a document is classified again', async () => {
    const { id } = await insertSyntheticDocument(harness.db, {
      status: 'extracted',
      confidence: 0.9,
    });
    await harness.db.insert(documentPages).values({ documentId: id, page: 1, text: 'A bill' });
    const document = await loadDocument(harness.db, id);
    if (document === undefined) throw new Error('The document is not live');
    await runClassificationStage(harness.deps(), document, live());
    expect(await harness.document(id)).toMatchObject({ status: 'classified', confidence: null });
  });

  it('keeps a type a person chose while the model was answering', async () => {
    const ids = await seedTypes();
    const id = await harness.ingest('corrected meanwhile');
    const { document } = await classify(id, async () => {
      await harness.db
        .update(documents)
        .set({ typeId: ids.lease, manualFields: [MANUAL_TYPE_FIELD] })
        .where(eq(documents.id, id));
      return { decision: 'existing', slug: 'payslip', confidence: 0.9 };
    });
    expect(document.typeId).toBe(ids.lease);
  });
});
