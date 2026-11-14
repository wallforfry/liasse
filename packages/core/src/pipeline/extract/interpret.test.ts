import { describe, expect, it } from 'vitest';
import type { EntityProvenance } from '../../domain/provenance.ts';
import type { RegisteredType } from '../../registry/type-store.ts';
import type { EntityMentionInput, EntityResolver } from '../deps.ts';
import { redactSensitiveIdentifiers } from '../../entities/detect-sensitive.ts';
import { SYNTHETIC_IBAN } from '../harness.test-helper.ts';
import { extractionOutputSchema, REJECTED } from './extraction-schema.ts';
import { interpret } from './interpret.ts';
import { createQuoteIndex } from './quotes.ts';
import { readOutput } from './read-output.ts';

const TYPE: RegisteredType = {
  id: 'typ_SYNTHETIC',
  slug: 'energy_bill',
  description: 'Bill',
  version: 4,
  status: 'stable',
  parentSlug: null,
  aliases: [],
  fields: {
    meter_id: { type: 'identifier' },
    consumption_kwh: { type: 'number' },
    energy: { type: 'enum', values: ['electricity', 'gas'] },
    tags: { type: 'list', items: { type: 'text' } },
    broker: { type: 'entity' },
  },
};

const PAGES = [
  {
    page: 1,
    text: 'Synthetic Energy SA\nInvoice SYN-1 of 03/10/2026\nTotal 84,20 EUR\n350 kWh gas\nAgent: Refused Name',
  },
  {
    page: 2,
    text: `Card 4242 4242 4242 4242\nIBAN ${SYNTHETIC_IBAN}\nPaid to Bank ${SYNTHETIC_IBAN}`,
  },
];

const at = (value: unknown, quote: string, page = 1, confidence = 0.8) => ({
  value,
  page,
  quote,
  confidence,
});

const resolver = (refuse: readonly string[] = []) => {
  const mentions: EntityMentionInput[] = [];
  const entities: Pick<EntityResolver, 'resolve'> = {
    resolve: (mention) => {
      mentions.push(mention);
      const resolution: EntityProvenance = {
        entity_id: `ent_${mention.name}`,
        match: 'created',
        confidence: 1,
      };
      const resolved = { provenance: resolution, droppedIdentifiers: 2 };
      return Promise.resolve(refuse.includes(mention.name) ? undefined : resolved);
    },
  };
  return { mentions, entities };
};

const read = async (
  raw: unknown,
  type: RegisteredType = TYPE,
  refuse: string[] = [],
  mask: (text: string) => string = redactSensitiveIdentifiers,
) => {
  const { mentions, entities } = resolver(refuse);
  const output = extractionOutputSchema(type.fields).parse(raw);
  const document = await interpret(
    {
      entities,
      maskSensitive: mask,
    },
    { output, model: 'synthetic-model' },
    { type, pages: PAGES, private: true },
  );
  return { document, mentions, output };
};

describe('the extraction output schema', () => {
  it('parses one bad element to REJECTED and keeps the others', () => {
    const output = extractionOutputSchema(TYPE.fields).parse({
      core: { amount: at('eighty', 'Total 84,20 EUR'), reference: at('SYN-1', 'Invoice SYN-1') },
      fields: { tags: [at('gas', 'gas'), { value: 'no evidence' }] },
      extra: {},
      facts: [{ text: 'no quote' }],
    });
    expect(output.core.amount).toBe(REJECTED);
    expect(output.core.reference).toMatchObject({ value: 'SYN-1' });
    expect(output.fields.tags).toEqual([at('gas', 'gas'), REJECTED]);
    expect(output.facts).toEqual([REJECTED]);
  });

  it('reads null, and a value of null, as a field the model did not find', () => {
    const output = extractionOutputSchema(TYPE.fields).parse({
      title: null,
      core: { amount: null, reference: { value: null, page: 1, quote: 'x', confidence: 0 } },
      fields: null,
      extra: null,
    });
    expect(output).toEqual({ core: {}, fields: {}, extra: {} });
  });

  it('moves a key that `core` or `fields` does not know to `extra`, under what the model wrote there', () => {
    const output = extractionOutputSchema(TYPE.fields).parse({
      core: { vat_rate: at(20, '20') },
      fields: { tariff: at('blue', 'blue'), contract: at('moved', 'x') },
      extra: { contract: at('written', 'x') },
    });
    expect(output.core).toEqual({});
    expect(output.fields).toEqual({});
    expect(Object.keys(output.extra).sort()).toEqual(['contract', 'tariff', 'vat_rate']);
    expect(output.extra.contract).toMatchObject({ value: 'written' });
  });

  it('refuses a quote longer than the limit', () => {
    const output = extractionOutputSchema({}).parse({
      core: { reference: at('SYN-1', 'x'.repeat(301)) },
      fields: {},
      extra: {},
    });
    expect(output.core.reference).toBe(REJECTED);
  });
});

describe('interpret', () => {
  it('drops a value whose quote is not in the text, and only that value', async () => {
    const { document } = await read({
      core: {
        reference: at('SYN-1', 'Invoice SYN-1'),
        due_date: at('2026-10-18', 'due 18/10/2026'),
      },
      fields: { meter_id: at('PDL-9', 'Meter PDL-9'), consumption_kwh: at(350, '350 kWh') },
      extra: {},
    });
    expect(document.core).toEqual({ reference: 'SYN-1' });
    expect(document.fields).toEqual({ consumption_kwh: 350 });
    expect(document.provenance).toEqual({
      reference: {
        model: 'synthetic-model',
        schema_version: 4,
        confidence: 0.8,
        page: 1,
        quote: 'Invoice SYN-1',
      },
      consumption_kwh: {
        model: 'synthetic-model',
        schema_version: 4,
        confidence: 0.8,
        page: 1,
        quote: '350 kWh',
      },
    });
    expect(document).toMatchObject({ rejected: 2, rejectedCore: 1 });
    expect(document.coreConfidences).toEqual({ reference: [0.8] });
  });

  it('drops a date or an amount that its own quote does not hold', async () => {
    const { document } = await read({
      core: {
        document_date: at('2025-10-03', 'of 03/10/2026'),
        amount: at({ value: 48.2, currency: 'EUR' }, 'Total 84,20 EUR'),
      },
      fields: {},
      extra: {},
    });
    expect(document.core).toEqual({});
    expect(document.rejectedCore).toBe(2);
  });

  it('drops a value the registry refuses, and the items of a list one by one', async () => {
    const { document } = await read({
      core: { period: at({ start: '2026-12-01', end: '2026-01-01' }, 'of 03/10/2026') },
      fields: {
        energy: at('coal', 'gas'),
        tags: [at('gas', 'gas'), at('made up', 'not in the text'), at('kWh', 'kWh')],
      },
      extra: {},
    });
    expect(document.core).toEqual({});
    expect(document.fields).toEqual({ tags: ['gas', 'kWh'] });
    expect(document.provenance.tags).toMatchObject([{ quote: 'gas' }, { quote: 'kWh' }]);
    expect(document.rejected).toBe(3);
  });

  it('keeps in `extra` only primitives under keys that could become field names', async () => {
    const { document } = await read({
      core: {},
      fields: {},
      extra: {
        tariff: at('gas', 'gas'),
        readings: at([350, 'gas'], '350 kWh gas'),
        unstated: at([350, 351], '350 kWh'),
        nested: at({ deep: true }, 'gas'),
        meter_id: at('shadow of a type field', 'gas'),
        document_date: at('2026-10-03', '03/10/2026'),
        'Free Text Key': at('x', 'gas'),
        ['__proto__']: at('x', 'gas'),
      },
    });
    expect(document.extra).toEqual({ tariff: 'gas', readings: [350, 'gas'] });
    expect(document.provenance.readings).toMatchObject({ quote: '350 kWh gas' });
  });

  it('drops an entity value the resolver refuses, and passes the name masked', async () => {
    const { document, mentions } = await read(
      {
        core: {
          issuer: at('Refused Name', 'Agent: Refused Name'),
          recipient: at(`Bank ${SYNTHETIC_IBAN}`, `Paid to Bank ${SYNTHETIC_IBAN}`, 2),
        },
        fields: { broker: at('Synthetic Energy SA', 'Synthetic Energy SA') },
        extra: {},
        entities: [
          { name: 'synthetic  energy sa', kind: 'org', context: `pays ${SYNTHETIC_IBAN}` },
        ],
      },
      TYPE,
      ['Refused Name'],
    );
    expect(document.core).toEqual({ recipient: 'Bank ****6789' });
    // What the resolver did not keep of the two mentions it resolved.
    expect(document.droppedIdentifiers).toBe(4);
    expect(document.rejectedCore).toBe(1);
    expect(document.provenance.broker).toEqual({
      entity_id: 'ent_Synthetic Energy SA',
      match: 'created',
      confidence: 1,
    });
    expect(mentions).toEqual([
      { name: 'Refused Name' },
      { name: 'Bank ****6789' },
      { name: 'Synthetic Energy SA', kind: 'org', context: 'pays ****6789' },
    ]);
  });

  // An id is 26 characters of base32: a detector can take a run of them for an account
  // number, and a masked id designates nothing.
  it('masks the quote of a provenance entry and none of its identifiers', async () => {
    const greedy = (text: string): string =>
      text.replace(/ent_|synthetic-model|Synthetic Energy SA/g, '****');
    const { document } = await read(
      {
        core: { reference: at('SYN-1', 'Synthetic Energy SA\nInvoice SYN-1') },
        fields: { broker: at('Synthetic Energy SA', 'Synthetic Energy SA') },
        extra: {},
      },
      TYPE,
      [],
      greedy,
    );
    expect(document.provenance.broker).toEqual({
      entity_id: 'ent_****',
      match: 'created',
      confidence: 1,
    });
    expect(document.provenance.reference).toMatchObject({
      model: 'synthetic-model',
      quote: '****\nInvoice SYN-1',
    });
  });

  it('does not keep a number that is a sensitive identifier', async () => {
    const maskCards = (text: string): string => text.replace(/4242 ?4242 ?4242 ?4242/g, '****4242');
    const { document } = await read(
      {
        core: {},
        fields: { consumption_kwh: at(4242424242424242, 'Card 4242 4242 4242 4242', 2) },
        extra: {
          card_numbers: at([4242424242424242], 'Card 4242 4242 4242 4242', 2),
          usage: at(350, '350 kWh'),
        },
      },
      TYPE,
      [],
      maskCards,
    );
    expect(document.fields).toEqual({});
    expect(document.extra).toEqual({ usage: 350 });
    expect(Object.keys(document.provenance)).toEqual(['usage']);
    expect(document.rejected).toBe(2);
  });

  it('never keeps a fact in which an identifier can still be detected once masked', async () => {
    // A masker that only replaces the first identifier it finds in a text.
    const firstOnly = (text: string): string => text.replace(SYNTHETIC_IBAN, '****6789');
    const fact = (text: string) => ({
      text,
      subjects: ['Home'],
      page: 2,
      quote: `IBAN ${SYNTHETIC_IBAN}`,
      confidence: 0.9,
    });
    const { document } = await read(
      {
        core: {},
        fields: {},
        extra: {},
        facts: [
          fact(`Paid on ${SYNTHETIC_IBAN}.`),
          fact(`Paid on ${SYNTHETIC_IBAN}, then on ${SYNTHETIC_IBAN}.`),
          { ...fact('About two accounts.'), subjects: [`${SYNTHETIC_IBAN} ${SYNTHETIC_IBAN}`] },
        ],
      },
      TYPE,
      [],
      firstOnly,
    );
    expect(document.knowledge.facts).toMatchObject([
      { text: 'Paid on ****6789.', quote: 'IBAN ****6789' },
    ]);
    expect(JSON.stringify(document.knowledge)).not.toContain(SYNTHETIC_IBAN);
  });

  it('keeps at most five facts, each with a quote in the text and a coherent validity', async () => {
    const fact = (text: string, extra: object = {}) => ({
      text,
      page: 1,
      quote: 'Invoice SYN-1',
      confidence: 0.7,
      ...extra,
    });
    const { document } = await read({
      core: {},
      fields: {},
      extra: {},
      facts: [
        fact('unsourced', { quote: 'not in the text' }),
        fact('backwards', { valid_from: '2026-02-01', valid_to: '2026-01-01' }),
        ...['one', 'two', 'three', 'four', 'five', 'six'].map((text) => fact(text)),
      ],
    });
    expect(document.knowledge.facts.map(({ text }) => text)).toEqual([
      'one',
      'two',
      'three',
      'four',
      'five',
    ]);
    expect(document.rejected).toBe(3);
  });

  // The output schema refuses these before the registry sees them: this reads an output
  // that did not go through it, as a model port that does not validate would hand it.
  it('lets the registry refuse a value, a field or an extra the output schema let through', () => {
    const quotes = createQuoteIndex(PAGES);
    const reading = readOutput(
      {
        core: { amount: at('eighty', 'Total 84,20 EUR'), reference: at('SYN-1', 'Invoice SYN-1') },
        fields: {
          energy: at('coal', 'gas'),
          no_such_field: at('x', 'gas'),
          tags: [at('gas', 'gas')],
        },
        extra: { nested: at({ deep: true }, 'gas'), usage: at(350, '350 kWh') },
      },
      TYPE.fields,
      { quotes, language: 'en' },
    );
    expect(Object.keys(reading.core.readings)).toEqual(['reference']);
    expect(Object.keys(reading.fields.readings)).toEqual(['tags']);
    expect(Object.keys(reading.extra.readings)).toEqual(['usage']);
    expect([reading.core.rejected, reading.fields.rejected, reading.extra.rejected]).toEqual([
      1, 2, 1,
    ]);
  });

  it('keeps at most fifty keys of `extra`', async () => {
    const extra = Object.fromEntries(
      Array.from({ length: 51 }, (_, index) => [`key_${String(index)}`, at('gas', 'gas')]),
    );
    const { document } = await read({ core: {}, fields: {}, extra });
    expect(Object.keys(document.extra)).toHaveLength(50);
    expect(document.rejected).toBe(1);
  });

  it('cuts the title and the summary to their limits, and reads no title as none', async () => {
    const { document } = await read({
      title: `  ${'t'.repeat(300)}  `,
      summary: '   ',
      core: {},
      fields: {},
      extra: {},
    });
    expect(document.title).toHaveLength(200);
    expect(document.summary).toBeNull();
  });
});
