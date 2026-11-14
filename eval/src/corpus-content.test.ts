import { createHash } from 'node:crypto';
import { entityNameKey } from '@liasse/core/domain';
import { findSensitiveIdentifiers } from '@liasse/core/entities';
import { createFakeVisionModel } from '@liasse/core/testing';
import { extractText, type ExtractedText } from '@liasse/core/text';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadCorpus, readDocumentFile } from './corpus.ts';
import {
  FICTITIOUS_BANK_CODE,
  frenchBankCode,
  isLuhnValid,
  isValidIban,
  TEST_CARD_NUMBER,
} from './identifiers.ts';
import type { Corpus, GroundTruth } from './schema/index.ts';
import { SCENARIO } from './scenario/index.ts';

// What the fake vision model answers for a page it is shown: no model reads the corpus
// here, the test only needs to know which pages were sent to one.
const TRANSCRIBED = 'page sent to the vision model';

let corpus: Corpus;
const extracted = new Map<string, ExtractedText>();

const read = (bytes: Uint8Array, mime: GroundTruth['mime']): Promise<ExtractedText> =>
  extractText({ bytes, mime }, { vision: createFakeVisionModel(() => TRANSCRIBED) });

beforeAll(async () => {
  corpus = await loadCorpus();
  for (const document of corpus.documents) {
    const bytes = await readDocumentFile(document);
    if (bytes !== undefined) extracted.set(document.id, await read(bytes, document.mime));
  }
  // A document carried by an email is read from what the extractor finds in the email.
  for (const document of corpus.documents) {
    if (document.source.kind !== 'attachment') continue;
    const { filename } = document.source;
    const carried = extracted
      .get(document.source.of)
      ?.attachments.find((attachment) => attachment.filename === filename);
    if (carried !== undefined) extracted.set(document.id, await read(carried.bytes, document.mime));
  }
});

const squash = (text: string): string => text.replace(/\s+/g, ' ').trim();

// What the pipeline will read: the text layer where there is one, and for a page without
// one, the text the truth says the page shows.
const readableText = (document: GroundTruth): string =>
  squash(
    document.pages
      .map(({ page, method, text }) =>
        method === 'vision' ? text : (extracted.get(document.id)?.pages[page - 1]?.text ?? ''),
      )
      .join('\n'),
  );

const quotesOf = (document: GroundTruth): readonly string[] =>
  [
    ...Object.values(document.core),
    ...document.fields.map(({ expectation }) => expectation),
    ...document.key_dates.map(({ expectation }) => expectation),
  ].flatMap((expectation) =>
    expectation.requirement === 'forbidden' || expectation.quote === null
      ? []
      : [expectation.quote],
  );

describe('the documents of the corpus, read by extractText', () => {
  it('are all readable, the attachment through its email', () => {
    expect(corpus.documents.filter(({ id }) => !extracted.has(id)).map(({ id }) => id)).toEqual([]);
  });

  it('send to the vision model exactly the pages the truth says have no text layer', () => {
    const actual = corpus.documents.map(({ id }) => [
      id,
      extracted.get(id)?.pages.map(({ method }) => method),
    ]);
    const expected = corpus.documents.map(({ id, pages }) => [
      id,
      pages.map(({ method }) => method),
    ]);
    expect(actual).toEqual(expected);
  });

  it('hand the attached bill out of its email with the bytes the truth describes', () => {
    const carried = corpus.documents.flatMap((document) => {
      if (document.source.kind !== 'attachment') return [];
      const { of, filename } = document.source;
      const attachment = extracted
        .get(of)
        ?.attachments.find((found) => found.filename === filename);
      const hash =
        attachment === undefined
          ? undefined
          : createHash('sha256').update(attachment.bytes).digest('hex');
      return [[document.sha256, hash]];
    });
    expect(carried).toHaveLength(1);
    expect(carried.filter(([expected, actual]) => expected !== actual)).toEqual([]);
  });

  it('contain every value the truth quotes', () => {
    const absent = corpus.documents.flatMap((document) => {
      const text = readableText(document);
      return quotesOf(document)
        .filter((quote) => !text.includes(squash(quote)))
        .map((quote) => `${document.id}: ${quote}`);
    });
    expect(absent).toEqual([]);
  });

  it('quote, for a required or optional value, words and not nothing', () => {
    const unquoted = corpus.documents.flatMap(({ id, core }) =>
      Object.entries(core)
        .filter(
          ([name, expectation]) =>
            name !== 'language' &&
            name !== 'period' &&
            expectation.requirement === 'required' &&
            expectation.quote === null,
        )
        .map(([name]) => `${id}: ${name}`),
    );
    expect(unquoted).toEqual([]);
  });

  it('print an issuer and a recipient under a name of their entity', () => {
    const namesOf = new Map(
      corpus.entities.map(({ key, canonical_name, aliases }) => [
        key,
        [canonical_name, ...aliases].map(entityNameKey),
      ]),
    );
    const unnamed = corpus.documents.flatMap(({ id, core }) =>
      [core.issuer, core.recipient].flatMap((expectation) =>
        expectation.requirement === 'forbidden' ||
        expectation.quote === null ||
        namesOf.get(expectation.value)?.includes(entityNameKey(expectation.quote)) === true
          ? []
          : [`${id}: ${expectation.quote}`],
      ),
    );
    expect(unnamed).toEqual([]);
  });

  it('show the clear value of every identifier the truth wants masked', () => {
    const hidden = corpus.documents.flatMap((document) =>
      document.masking
        .filter(({ clear }) => !readableText(document).includes(squash(clear)))
        .map(({ kind }) => `${document.id}: ${kind}`),
    );
    expect(hidden).toEqual([]);
  });
});

const MAX_LINE_LENGTH = 76;
const MAX_PAGE_LINES = 48;

describe('the pages of the scenario', () => {
  it('fit the sheet they are set on', () => {
    const overflowing = SCENARIO.flatMap(({ id, render }) =>
      render.kind === 'pdf'
        ? render.pages
            .filter(
              ({ lines }) =>
                lines.length > MAX_PAGE_LINES ||
                lines.some((line) => line.length > MAX_LINE_LENGTH),
            )
            .map(() => id)
        : [],
    );
    expect(overflowing).toEqual([]);
  });
});

const RESERVED_EMAIL_DOMAIN = /(?:^|\.)(?:example\.(?:com|org|net)|example|test|invalid)$/;
const EMAIL = /[\w.+-]+@([\w-]+(?:\.[\w-]+)+)/g;
const IBAN = /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,3})?\b/g;
const CARD = /\b\d{4}(?: \d{4}){3}\b/g;
const FRENCH_PHONE = /\b0\d(?: \d{2}){4}\b/g;
const BRITISH_PHONE = /\b0\d{2} \d{4} \d{4}\b/g;
// The ranges the French and British regulators set aside for fiction.
const FICTION_PHONE = /^(?:01 99 00|06 39 98|020 7946 0)/;

describe('the forbidden-data rule', () => {
  // Everything a document shows: its pages, and the headers of an email.
  const everything = (): string =>
    [
      ...corpus.documents.flatMap(({ pages }) => pages.map(({ text }) => text)),
      ...[...extracted.values()].flatMap(({ pages }) => pages.map(({ text }) => text)),
    ].join('\n');

  it('only writes to reserved e-mail domains', () => {
    const domains = [...everything().matchAll(EMAIL)].map(([, domain = '']) => domain);
    expect(domains.length).toBeGreaterThan(5);
    expect([...new Set(domains)].filter((domain) => !RESERVED_EMAIL_DOMAIN.test(domain))).toEqual(
      [],
    );
  });

  it('only prints valid IBANs of the fictitious bank', () => {
    const ibans = [...new Set(everything().match(IBAN) ?? [])];
    expect(ibans.length).toBeGreaterThanOrEqual(1);
    expect(ibans.filter((iban) => !isValidIban(iban))).toEqual([]);
    expect(ibans.map(frenchBankCode)).toEqual(ibans.map(() => FICTITIOUS_BANK_CODE));
  });

  it('only prints the card number published for tests', () => {
    const cards = [...new Set(everything().replace(IBAN, '').match(CARD) ?? [])];
    expect(cards.map((card) => card.replace(/ /g, ''))).toEqual([TEST_CARD_NUMBER]);
  });

  // The identifiers the truth wants masked must be ones the system under test can see:
  // its detector only takes an IBAN that passes mod 97 and a card in an issuer range.
  it('prints its IBAN and its card number in a form the detector of Liasse finds', () => {
    const undetected = corpus.documents.flatMap((document) => {
      const found = findSensitiveIdentifiers(document.pages.map(({ text }) => text).join('\n')).map(
        ({ value }) => value.replace(/\s/g, ''),
      );
      return document.masking
        .filter(({ kind }) => kind === 'iban' || kind === 'card_number')
        .filter(({ clear }) => !found.includes(clear.replace(/\s/g, '')))
        .map(({ kind }) => `${document.id}: ${kind}`);
    });
    expect(undetected).toEqual([]);
  });

  it('only prints phone numbers reserved for fiction', () => {
    const text = everything().replace(IBAN, '');
    const phones = [...(text.match(FRENCH_PHONE) ?? []), ...(text.match(BRITISH_PHONE) ?? [])];
    expect(phones.length).toBeGreaterThan(10);
    expect([...new Set(phones)].filter((phone) => !FICTION_PHONE.test(phone))).toEqual([]);
  });

  // A French company number always passes the Luhn check: one that fails it is in no
  // register, whatever its digits.
  it('only prints company numbers that cannot be register entries', () => {
    const numbers = [...everything().matchAll(/\bSIRE[NT] (\d{9}(?:\d{5})?)\b/g)].map(
      ([, digits = '']) => digits,
    );
    expect(new Set(numbers).size).toBeGreaterThanOrEqual(10);
    expect([...new Set(numbers)].filter(isLuhnValid)).toEqual([]);
  });

  it('only prints web addresses on reserved domains', () => {
    const hosts = [...everything().matchAll(/\b(?:https?:\/\/|www\.)([\w-]+(?:\.[\w-]+)+)/g)].map(
      ([, host = '']) => host,
    );
    expect(hosts.length).toBeGreaterThanOrEqual(3);
    expect([...new Set(hosts)].filter((host) => !RESERVED_EMAIL_DOMAIN.test(host))).toEqual([]);
  });

  it('gives the owner a year of birth that makes her an adult in her oldest document', () => {
    const [, year = ''] = /N° de sécurité sociale : \d (\d{2})/.exec(everything()) ?? [];
    const oldest = corpus.documents
      .flatMap(({ core }) =>
        core.document_date.requirement === 'forbidden' ? [] : [core.document_date.value],
      )
      .sort()[0];
    expect(Number(oldest?.slice(0, 4)) - (1900 + Number(year))).toBeGreaterThanOrEqual(18);
  });
});
