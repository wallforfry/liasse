import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { chunks, documentPages } from '../db/schema/documents.ts';
import { documentDates, facts } from '../db/schema/knowledge.ts';
import { docTypes, entities } from '../db/schema/registry.ts';
import { PIPELINE_PROVENANCE_KEY } from '../domain/provenance.ts';
import { deleteDocument } from '../ingest/delete-document.ts';
import { createGate, sleep } from '../testing/async.ts';
import { createFakeEmbedder } from '../testing/fake-embedder.ts';
import {
  createPipelineHarness,
  live,
  pagesOf,
  type PipelineHarness,
  scriptedModel,
  SYNTHETIC_IBAN,
  SYNTHETIC_IBAN_MASKED,
} from './harness.test-helper.ts';
import { processDocument } from './process-document.ts';

const TEXT = pagesOf(
  [
    'Synthetic Energy SA',
    'Invoice SYN-2026-001 dated 03/10/2026',
    'Customer: Jane Synthetic',
    'Total 84,20 EUR due 18/10/2026',
    `Payee Synthetic Energy SA IBAN ${SYNTHETIC_IBAN}`,
    'Meter PDL-000123',
  ].join('\n'),
  'The contract renews on 01/03/2027.',
);

const TYPE = {
  decision: 'new',
  confidence: 0.9,
  justification: 'No candidate describes an energy bill. The registry is empty.',
  new_type: {
    slug: 'energy_bill',
    description: 'Bill from an electricity or gas supplier',
    parent_slug: null,
    fields: {
      meter_id: { type: 'identifier' },
      payment_account: { type: 'identifier', format: 'IBAN' },
      parties: { type: 'list', items: { type: 'entity' } },
    },
  },
};

const at = (value: unknown, quote: string, page = 1, confidence = 0.9) => ({
  value,
  page,
  quote,
  confidence,
});

const OUTPUT = {
  title: `Energy bill paid to ${SYNTHETIC_IBAN}`,
  summary: `A bill of Synthetic Energy. It is paid to ${SYNTHETIC_IBAN}.`,
  core: {
    issuer: at('Synthetic Energy SA', 'Synthetic Energy SA'),
    recipient: at('Jane Synthetic', 'Customer: Jane Synthetic'),
    document_date: at('2026-10-03', 'dated 03/10/2026'),
    amount: at({ value: 84.2, currency: 'EUR' }, 'Total 84,20 EUR'),
    reference: at(SYNTHETIC_IBAN, `IBAN ${SYNTHETIC_IBAN}`),
    language: at('fr', 'Invoice SYN-2026-001'),
    key_dates: [
      at(
        { kind: 'renewal', date: '2027-03-01', label: `Renewal, paid to ${SYNTHETIC_IBAN}` },
        'renews on 01/03/2027',
        1,
      ),
    ],
  },
  fields: {
    meter_id: at('PDL-000123', 'Meter PDL-000123'),
    payment_account: at(SYNTHETIC_IBAN, `IBAN ${SYNTHETIC_IBAN}`),
    parties: [
      at('Synthetic Energy SA', 'Synthetic Energy SA'),
      at('Jane Synthetic', 'Customer: Jane Synthetic'),
    ],
  },
  extra: {
    payment_iban: at(SYNTHETIC_IBAN, `IBAN ${SYNTHETIC_IBAN}`),
    issuer: at('Shadow', 'Synthetic Energy SA'),
    'Not A Field Name': at('x', 'Synthetic Energy SA'),
  },
  entities: [
    {
      name: 'Synthetic Energy SA',
      kind: 'org',
      identifiers: [
        { type: 'iban', value: SYNTHETIC_IBAN },
        { type: 'company_id', value: 'NOT-IN-THE-TEXT' },
      ],
    },
  ],
  facts: [
    {
      text: `Synthetic Energy SA is paid on ${SYNTHETIC_IBAN}.`,
      valid_from: '2026-10-03',
      entities: ['Synthetic Energy SA'],
      subjects: ['Home'],
      page: 1,
      quote: `Payee Synthetic Energy SA IBAN ${SYNTHETIC_IBAN}`,
      confidence: 0.8,
    },
  ],
  subjects: [{ kind: 'account', name: `Account ${SYNTHETIC_IBAN}`, identifier: SYNTHETIC_IBAN }],
};

describe('processDocument', () => {
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

  const depsFor = (output: unknown = OUTPUT, overrides = {}) =>
    harness.deps({
      textModel: scriptedModel({ classify: () => TYPE, extract: () => output }),
      extractText: () => Promise.resolve(TEXT),
      ...overrides,
    });

  it('takes a document from received to indexed, with its type, values and provenance', async () => {
    const id = await harness.ingest('energy bill');
    const hooked: string[] = [];
    await processDocument(
      depsFor(OUTPUT, { afterIndexed: (done: string) => Promise.resolve(void hooked.push(done)) }),
      id,
      live(),
    );
    const document = await harness.document(id);
    const [type] = await harness.db.select().from(docTypes);
    expect(document).toMatchObject({
      status: 'indexed',
      error: null,
      typeId: type?.id,
      schemaVersion: 1,
      core: {
        issuer: 'Synthetic Energy SA',
        recipient: 'Jane Synthetic',
        document_date: '2026-10-03',
        amount: { value: 84.2, currency: 'EUR' },
      },
      fields: { meter_id: 'PDL-000123', parties: ['Synthetic Energy SA', 'Jane Synthetic'] },
    });
    expect(document.confidence).toBeCloseTo(0.9, 5);
    expect(document.provenance.document_date).toEqual({
      model: 'fake-text-model',
      schema_version: 1,
      confidence: 0.9,
      page: 1,
      quote: 'dated 03/10/2026',
    });
    expect(harness.indexed).toEqual([id]);
    expect(hooked).toEqual([id]);
    expect(
      (await harness.db.select().from(documentPages).where(eq(documentPages.documentId, id)))
        .length,
    ).toBe(2);
  });

  it('keeps the entity name in the value and the entity in the provenance, one entry per item', async () => {
    const id = await harness.ingest('entities');
    await processDocument(depsFor(), id, live());
    const { provenance } = await harness.document(id);
    const known = await harness.db.select().from(entities);
    const issuer = known.find(({ canonicalName }) => canonicalName === 'Synthetic Energy SA');
    const recipient = known.find(({ canonicalName }) => canonicalName === 'Jane Synthetic');
    expect(known).toHaveLength(2);
    expect(provenance.issuer).toEqual({ entity_id: issuer?.id, match: 'created', confidence: 1 });
    expect(provenance.parties).toEqual([
      { entity_id: issuer?.id, match: 'created', confidence: 1 },
      { entity_id: recipient?.id, match: 'created', confidence: 1 },
    ]);
    // Each name is resolved once, with the kind the model gave and only the identifiers
    // that are written in the document.
    expect(harness.entities.mentions).toEqual([
      {
        name: 'Synthetic Energy SA',
        kind: 'org',
        identifiers: [{ type: 'iban', value: SYNTHETIC_IBAN }],
      },
      { name: 'Jane Synthetic' },
    ]);
    expect(harness.entities.options).toEqual([
      { allowExternalEmbedding: true },
      { allowExternalEmbedding: true },
    ]);
  });

  it('masks a sensitive identifier everywhere but in the text of the document', async () => {
    const id = await harness.ingest('masking');
    await processDocument(depsFor(), id, live());
    const document = await harness.document(id);
    const dates = await harness.db.select().from(documentDates);
    const stored = await harness.db.select().from(facts);
    const everything = JSON.stringify([document, dates, stored]);
    expect(everything).not.toContain('0123 4567');
    expect(document.core.reference).toBe(SYNTHETIC_IBAN_MASKED);
    expect(document.fields.payment_account).toBe(SYNTHETIC_IBAN_MASKED);
    expect(document.extra).toEqual({ payment_iban: SYNTHETIC_IBAN_MASKED });
    expect(document.provenance.payment_account).toMatchObject({
      quote: `IBAN ${SYNTHETIC_IBAN_MASKED}`,
    });
    expect(document.title).toBe(`Energy bill paid to ${SYNTHETIC_IBAN_MASKED}`);
    expect(document.summary).toContain(SYNTHETIC_IBAN_MASKED);
    expect(dates[0]?.label).toBe(`Renewal, paid to ${SYNTHETIC_IBAN_MASKED}`);
    expect(stored[0]).toMatchObject({
      text: `Synthetic Energy SA is paid on ${SYNTHETIC_IBAN_MASKED}.`,
      quote: `Payee Synthetic Energy SA IBAN ${SYNTHETIC_IBAN_MASKED}`,
    });
    const [page] = await harness.db.select().from(documentPages);
    expect(page?.text).toContain(SYNTHETIC_IBAN);
  });

  it('stores the key dates and the facts of the same call, on the page the quote stands on', async () => {
    const id = await harness.ingest('knowledge');
    await processDocument(depsFor(), id, live());
    const [issuer] = await harness.db
      .select()
      .from(entities)
      .where(eq(entities.canonicalName, 'Synthetic Energy SA'));
    expect(await harness.db.select().from(documentDates)).toMatchObject([
      {
        documentId: id,
        kind: 'renewal',
        date: '2027-03-01',
        model: 'fake-text-model',
        schemaVersion: 1,
        page: 2,
        quote: 'renews on 01/03/2027',
      },
    ]);
    expect(await harness.db.select().from(facts)).toMatchObject([
      // The quote of the fact states no date: the validity the model gave is not kept.
      { documentId: id, validFrom: null, validTo: null, entityIds: [issuer?.id], page: 1 },
    ]);
    expect((await harness.document(id)).core.key_dates).toEqual([
      { kind: 'renewal', date: '2027-03-01', label: `Renewal, paid to ${SYNTHETIC_IBAN_MASKED}` },
    ]);
  });

  it('hands the validated knowledge to the injected store, in the transaction of the document', async () => {
    const id = await harness.ingest('injected knowledge');
    const received: unknown[] = [];
    await processDocument(
      depsFor(OUTPUT, {
        persistKnowledge: (_tx: unknown, document: unknown, knowledge: unknown) => {
          received.push(document, knowledge);
          return Promise.reject(new Error('the knowledge layer failed'));
        },
      }),
      id,
      live(),
    ).catch(() => undefined);
    expect(received[0]).toEqual({ id, private: false, language: 'fr' });
    expect(received[1]).toMatchObject({
      subjects: [
        {
          kind: 'account',
          name: `Account ${SYNTHETIC_IBAN_MASKED}`,
          identifier: SYNTHETIC_IBAN_MASKED,
        },
      ],
      facts: [{ subjects: ['Home'] }],
    });
    // The failure of the store undid the write of the document.
    expect(await harness.document(id)).toMatchObject({
      status: 'classified',
      core: {},
      title: null,
    });
  });

  it('indexes with the real indexer by default, in the language of the document', async () => {
    const id = await harness.ingest('really indexed');
    const { indexDocument: _fake, entities: _recording, ...defaults } = depsFor();
    await processDocument(defaults, id, live());
    const stored = await harness.db.select().from(chunks).where(eq(chunks.documentId, id));
    expect(stored.length).toBeGreaterThan(0);
    expect(stored.every(({ language, embedding }) => language === 'fr' && embedding !== null)).toBe(
      true,
    );
    expect((await harness.db.select().from(documentPages)).map(({ language }) => language)).toEqual(
      ['fr', 'fr'],
    );
    expect((await harness.db.select().from(facts)).map(({ language }) => language)).toEqual(['fr']);
    expect(await harness.document(id)).toMatchObject({ status: 'indexed' });
  });

  it('lets a deletion during the indexing win, without failing the job', async () => {
    const id = await harness.ingest('deleted before indexing');
    const { indexDocument: _fake, ...defaults } = depsFor(OUTPUT, {
      persistKnowledge: () => Promise.resolve(),
      afterIndexed: () => Promise.reject(new Error('a deleted document has no hook')),
    });
    const embedder = {
      ...defaults.embedder,
      embed: async (texts: readonly string[], kind: 'query' | 'passage') => {
        const extracted = (await harness.document(id)).confidence !== null;
        if (kind === 'passage' && extracted) await deleteDocument({ db: harness.db }, id);
        return defaults.embedder.embed(texts, kind);
      },
    };
    await processDocument({ ...defaults, embedder }, id, live());
    expect(await harness.document(id)).toMatchObject({ status: 'deleted' });
    expect(await harness.db.select().from(chunks)).toEqual([]);
  });

  // Verdict P4: each value has a quote that exists in the text and does not state it.
  it('stores none of the values the document does not state, nor what follows from them', async () => {
    const id = await harness.ingest('hallucinated');
    await processDocument(
      depsFor({
        title: 'Synthetic bill',
        core: {
          issuer: at('Totally Invented Corp', 'Invoice'),
          reference: at('HALLUCINATED-999', 'due'),
          amount: at({ value: 8420, currency: 'USD' }, 'Total 84,20 EUR'),
          document_date: at('2026-01-01', 'SYN-2026-001'),
          due_date: at('2018-12-25', 'due 18/10/2026'),
        },
        fields: { meter_id: at('PDL-999999', 'Meter') },
        extra: { negative_amount: at(-20, 'Total 84,20 EUR') },
        facts: [
          {
            text: 'The contract was terminated.',
            valid_from: '1999-01-01',
            page: 1,
            quote: 'Invoice',
            confidence: 0.9,
          },
        ],
      }),
      id,
      live(),
    );
    const document = await harness.document(id);
    expect(document).toMatchObject({
      core: {},
      fields: {},
      extra: {},
      confidence: 0,
      status: 'needs_review',
    });
    expect(document.provenance[PIPELINE_PROVENANCE_KEY]).toMatchObject({
      extraction: { rejected_values: 8 },
    });
    expect(await harness.db.select().from(entities)).toEqual([]);
    expect(await harness.db.select().from(facts)).toEqual([]);
  });

  it('records how the text, the type and the extraction were obtained', async () => {
    const id = await harness.ingest('pipeline provenance');
    await processDocument(depsFor(), id, live());
    expect((await harness.document(id)).provenance[PIPELINE_PROVENANCE_KEY]).toEqual({
      text: { method: 'native', attachments_ingested: 0, attachments_skipped: 0 },
      type: { model: 'fake-text-model', confidence: 0.9, outcome: 'new' },
      // The two extra keys that could not be kept.
      extraction: {
        model: 'fake-text-model',
        schema_version: 1,
        truncated: false,
        rejected_values: 2,
        // The company id the model gave for the issuer, which the text does not hold.
        dropped_identifiers: 1,
      },
    });
  });

  it('flags for review a document under the confidence threshold, and still indexes it', async () => {
    const id = await harness.ingest('low confidence');
    const output = { core: { reference: at('SYN-2026-001', 'Invoice SYN-2026-001', 1, 0.69) } };
    await processDocument(depsFor(output), id, live());
    expect(await harness.document(id)).toMatchObject({ status: 'needs_review' });
    expect(harness.indexed).toEqual([id]);
  });

  it('settles at exactly the threshold as indexed', async () => {
    const id = await harness.ingest('threshold');
    const output = { core: { reference: at('SYN-2026-001', 'Invoice SYN-2026-001', 1, 0.75) } };
    const deps = depsFor(output);
    await processDocument(
      { ...deps, settings: { ...deps.settings, confidenceThreshold: 0.75 } },
      id,
      live(),
    );
    expect(await harness.document(id)).toMatchObject({ status: 'indexed' });
  });

  it('gives a document with no core value a confidence of 0', async () => {
    const id = await harness.ingest('nothing extracted');
    await processDocument(depsFor({ core: {}, fields: {}, extra: {} }), id, live());
    expect(await harness.document(id)).toMatchObject({
      status: 'needs_review',
      confidence: 0,
      title: 'nothing extracted.pdf',
    });
  });

  it('resumes from the status the document has, without redoing what is stored', async () => {
    const id = await harness.ingest('resumed');
    let extractions = 0;
    const model = scriptedModel({ classify: () => TYPE, extract: () => OUTPUT });
    const deps = depsFor(OUTPUT, {
      textModel: model,
      extractText: () => {
        extractions += 1;
        return Promise.resolve(TEXT);
      },
      indexDocument: () => Promise.reject(new Error('the index is down')),
    });
    await expect(processDocument(deps, id, live())).rejects.toThrow('the index is down');
    expect(await harness.document(id)).toMatchObject({ status: 'classified' });
    await processDocument(depsFor(OUTPUT, { textModel: model }), id, live());
    expect(await harness.document(id)).toMatchObject({ status: 'indexed' });
    expect(extractions).toBe(1);
    // One classification and one extraction over the two runs.
    expect(model.calls).toHaveLength(2);
  });

  it('runs the hook again, and nothing else, for a document already settled', async () => {
    const id = await harness.ingest('settled');
    await processDocument(depsFor(), id, live());
    const model = scriptedModel({});
    const hooked: string[] = [];
    await processDocument(
      depsFor(OUTPUT, {
        textModel: model,
        afterIndexed: (done: string) => Promise.resolve(void hooked.push(done)),
      }),
      id,
      live(),
    );
    expect(model.calls).toHaveLength(0);
    expect(harness.indexed).toEqual([id]);
    expect(hooked).toEqual([id]);
  });

  it('stops quietly when the document is deleted while the model answers', async () => {
    const id = await harness.ingest('deleted meanwhile');
    const asked = createGate();
    const deleted = createGate();
    const deps = depsFor(OUTPUT, {
      textModel: scriptedModel({
        classify: () => TYPE,
        extract: async () => {
          asked.open();
          await deleted.opened;
          return OUTPUT;
        },
      }),
    });
    const processing = processDocument(deps, id, live());
    await asked.opened;
    await deleteDocument({ db: harness.db }, id);
    deleted.open();
    await processing;
    expect(await harness.document(id)).toMatchObject({ status: 'deleted', core: {}, title: null });
    expect(await harness.db.select().from(facts)).toEqual([]);
    expect(await harness.db.select().from(documentPages)).toEqual([]);
    expect(harness.indexed).toEqual([]);
  });

  it('lets the first of two jobs for one document write each stage', async () => {
    const id = await harness.ingest('two jobs');
    const model = scriptedModel({ classify: () => TYPE, extract: () => OUTPUT });
    const deps = depsFor(OUTPUT, { textModel: model });
    await Promise.all([processDocument(deps, id, live()), processDocument(deps, id, live())]);
    expect(await harness.document(id)).toMatchObject({ status: 'indexed' });
    expect(await harness.db.select().from(documentPages)).toHaveLength(2);
    expect(await harness.db.select().from(facts)).toHaveLength(1);
    expect(await harness.db.select().from(docTypes)).toHaveLength(1);
  });

  it('stops between two stages when the job is aborted', async () => {
    const id = await harness.ingest('aborted');
    const controller = new AbortController();
    const embedded: string[] = [];
    const deps = depsFor(OUTPUT, {
      extractText: () => {
        controller.abort(new Error('the workers are stopping'));
        return Promise.resolve(TEXT);
      },
      embedder: {
        ...createFakeEmbedder(),
        embed: (texts: readonly string[]) => {
          embedded.push(...texts);
          return createFakeEmbedder().embed(texts, 'query');
        },
      },
    });
    await expect(processDocument(deps, id, controller.signal)).rejects.toThrow(
      'the workers are stopping',
    );
    expect(await harness.document(id)).toMatchObject({ status: 'extracted' });
    // The next stage did not start.
    expect(embedded).toEqual([]);
  });

  it('makes a deletion wait for the write of the extraction, then remove what it wrote', async () => {
    const id = await harness.ingest('deleted during the write');
    // The deletion starts once the transaction has read the document and before it
    // writes anything: only the row lock taken first can hold it back.
    const deletions: Promise<boolean>[] = [];
    const outcomes: boolean[] = [];
    const racing: typeof harness.entities = {
      ...harness.entities,
      missingIds: async (tx, ids) => {
        const deletion = deleteDocument({ db: harness.db }, id);
        deletions.push(deletion);
        outcomes.push(
          await Promise.race([deletion.then(() => true), sleep(300).then(() => false)]),
        );
        return harness.entities.missingIds(tx, ids);
      },
    };
    await processDocument(depsFor(OUTPUT, { entities: racing }), id, live());
    expect(await Promise.all(deletions)).toEqual([true]);
    expect(outcomes).toEqual([false]);
    expect(await harness.document(id)).toMatchObject({ status: 'deleted', core: {} });
    expect(await harness.db.select().from(facts)).toEqual([]);
  });
});
