import type { FieldDefinition } from '@liasse/contract/registry';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { getDocument } from '../api/get-document.ts';
import { createFileUrls } from '../api/file-url.ts';
import { documentPages } from '../db/schema/documents.ts';
import { PIPELINE_PROVENANCE_KEY } from '../domain/provenance.ts';
import { createType } from '../registry/create-type.ts';
import { createFakeEmbedder } from '../testing/fake-embedder.ts';
import { createFakeTextModel, type FakeTextModel } from '../testing/fake-text-model.ts';
import { insertSyntheticDocument } from '../testing/fixtures.ts';
import { createPipelineHarness, live, type PipelineHarness } from './harness.test-helper.ts';
import { processDocument } from './process-document.ts';
import { AMOUNT_RULE, FIELD_TARGET_RULE, PLACE_RULE } from './prompts/extraction.ts';

// Three synthetic certificates on which a model was seen to put a figure in `core.amount`
// that is not an amount owed, or an address in a field meant for a place of issuance.
// Which field a figure or an address belongs to is a matter of meaning: the prompt says
// it, and no rule of the pipeline guesses it. The pipeline does read a value the model put
// in `extra` under the name of an empty field of the type as that field.

const at = (value: unknown, quote: string, confidence = 0.9) => ({
  value,
  page: 1,
  quote,
  confidence,
});

const eur = (value: number) => ({ value, currency: 'EUR' });

interface Certificate {
  readonly slug: string;
  readonly fields: Readonly<Record<string, FieldDefinition>>;
  readonly text: string;
}

const REGISTER: Certificate = {
  slug: 'company_register_certificate',
  fields: {
    register_location: { type: 'entity' },
    registered_address: { type: 'text' },
    share_capital: { type: 'money' },
  },
  text: [
    'Certificate of registration',
    'Company: Synthetic Widgets SAS',
    'Registered office: 12 Example Street, 99999 Sampletown',
    'Share capital: 10 000 EUR',
    'Registry: Sampletown Commercial Court',
  ].join('\n'),
};

const TAX: Certificate = {
  slug: 'tax_compliance_certificate',
  fields: {
    issuance_location: { type: 'text' },
    establishment_address: { type: 'text' },
  },
  text: [
    'Tax compliance certificate',
    'Company: Synthetic Widgets SAS',
    'Establishment: 4 Demo Avenue, 99998 Exampleville',
    'Done at Sampletown on 10/04/2026',
  ].join('\n'),
};

const SOCIAL: Certificate = {
  slug: 'social_contribution_certificate',
  fields: {
    monthly_payroll: { type: 'money' },
    amount_owed: { type: 'money' },
  },
  text: [
    'Certificate of social contributions',
    'Company: Synthetic Widgets SAS',
    'Monthly payroll declared: 8 733 EUR',
    'Contributions owed: 0 EUR',
  ].join('\n'),
};

describe('extraction of synthetic certificates', () => {
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

  // A document of the certificate's type, as the classification stage leaves it.
  const classified = async ({ slug, fields, text }: Certificate): Promise<string> => {
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
    const { id } = await insertSyntheticDocument(harness.db, {
      status: 'classified',
      typeId: created.value.id,
      provenance: {
        [PIPELINE_PROVENANCE_KEY]: {
          type: { model: 'classifier', confidence: 0.95, outcome: 'existing' },
        },
      },
    });
    await harness.db.insert(documentPages).values([{ documentId: id, page: 1, text }]);
    return id;
  };

  const extract = async (certificate: Certificate, output: unknown) => {
    const id = await classified(certificate);
    const model: FakeTextModel = createFakeTextModel([output]);
    await processDocument(harness.deps({ textModel: model }), id, live());
    return { id, system: model.calls[0]?.system ?? '', document: await harness.document(id) };
  };

  it('tells the model what an amount is, and reads a capital put in `extra` as its field', async () => {
    const { system, document } = await extract(REGISTER, {
      core: { recipient: at('Synthetic Widgets SAS', 'Company: Synthetic Widgets SAS') },
      fields: {
        register_location: at(
          'Sampletown Commercial Court',
          'Registry: Sampletown Commercial Court',
        ),
      },
      extra: {
        share_capital: at(eur(10000), 'Share capital: 10 000 EUR'),
        registered_address: at(
          '12 Example Street, 99999 Sampletown',
          'Registered office: 12 Example Street, 99999 Sampletown',
        ),
      },
    });
    expect(system).toContain(AMOUNT_RULE);
    expect(AMOUNT_RULE).toContain('"core.amount" is never a share capital');
    expect(system).toContain(PLACE_RULE);
    expect(document.core).toEqual({ recipient: 'Synthetic Widgets SAS' });
    expect(document.fields).toEqual({
      register_location: 'Sampletown Commercial Court',
      share_capital: eur(10000),
      registered_address: '12 Example Street, 99999 Sampletown',
    });
    expect(document.extra).toEqual({});
  });

  it('tells the model a place of issuance is not the address of an establishment', async () => {
    const { system, document } = await extract(TAX, {
      core: { document_date: at('2026-04-10', 'Done at Sampletown on 10/04/2026') },
      fields: { issuance_location: at('Sampletown', 'Done at Sampletown') },
      extra: {
        establishment_address: at(
          '4 Demo Avenue, 99998 Exampleville',
          'Establishment: 4 Demo Avenue, 99998 Exampleville',
        ),
      },
    });
    expect(PLACE_RULE).toContain('never the address of a registered office, of an establishment');
    expect(system).toContain(PLACE_RULE);
    expect(system).toContain(FIELD_TARGET_RULE);
    expect(document.fields).toEqual({
      issuance_location: 'Sampletown',
      establishment_address: '4 Demo Avenue, 99998 Exampleville',
    });
  });

  it('tells the model a payroll is not an amount, and names every rejected value in the review', async () => {
    const { id, system, document } = await extract(SOCIAL, {
      core: {
        recipient: at('Synthetic Widgets SAS', 'Company: Synthetic Widgets SAS'),
        due_date: at('2026-05-01', 'not written in the certificate'),
      },
      fields: { amount_owed: at(eur(120), 'Contributions owed: 0 EUR') },
      extra: {
        monthly_payroll: at(eur(8733), 'Monthly payroll declared: 8 733 EUR'),
        'Payroll Note': at('declared', 'Monthly payroll declared'),
      },
    });
    expect(AMOUNT_RULE).toContain('a payroll');
    expect(system).toContain(AMOUNT_RULE);
    expect(document.core).toEqual({ recipient: 'Synthetic Widgets SAS' });
    expect(document.fields).toEqual({ monthly_payroll: eur(8733) });
    const { review } = await getDocument(
      {
        db: harness.db,
        confidenceThreshold: 0.7,
        fileUrls: createFileUrls({
          secret: 'synthetic-file-url-secret-0123456789',
          publicUrl: 'https://liasse.example.com',
        }),
      },
      id,
      { include: ['review'] },
    );
    expect(review?.rejected_values).toBe(3);
    expect(review?.rejections).toEqual([
      { section: 'core', name: 'due_date', reason: 'quote_not_found', count: 1 },
      { section: 'fields', name: 'amount_owed', reason: 'quote_not_stating_value', count: 1 },
      { section: 'extra', name: 'Payroll Note', reason: 'invalid_key', count: 1 },
    ]);
    // What the model read is never kept for a value that was dropped.
    const stored = JSON.stringify(document.provenance);
    expect(stored).not.toContain('not written in the certificate');
    expect(stored).not.toContain('Contributions owed');
    expect(stored).not.toContain('120');
  });
});
