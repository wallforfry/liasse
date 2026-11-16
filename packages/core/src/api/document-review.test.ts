import { describe, expect, it } from 'vitest';
import { type ReviewedDocument, reviewDocument } from './document-review.ts';

const extracted = (confidence: number, quote: string, page = 1) => ({
  model: 'synthetic-model',
  schema_version: 1,
  confidence,
  page,
  quote,
});

const EXISTING = { model: 'synthetic-model', confidence: 0.95, outcome: 'existing' } as const;

const DOCUMENT: ReviewedDocument = {
  status: 'needs_review',
  confidence: 0.5,
  error: null,
  core: {
    reference: 'SYN-1',
    issuer: 'Synthetic Power',
    amount: { amount: 12.5, currency: 'EUR' },
    key_dates: [{ date: '2026-01-01' }, { date: '2026-02-01' }],
  },
  fields: { meter_ids: ['M-1', 'M-2'], note: 'Synthetic note' },
  provenance: {
    reference: extracted(0.5, 'Ref SYN-1', 2),
    issuer: { entity_id: 'ent_01SYNTHETIC', match: 'alias', confidence: 0.99 },
    amount: { manual: true },
    key_dates: [extracted(0.9, 'on 1 January 2026'), extracted(0.7, 'on 1 February 2026')],
    meter_ids: [extracted(0.6, 'meter M-1'), extracted(0.4, 'meter M-2', 3)],
    '@pipeline': {
      type: EXISTING,
      extraction: { model: 'm', schema_version: 1, truncated: false, rejected_values: 2 },
    },
  },
};

describe('reviewDocument', () => {
  it('rates each value against the threshold, a list by the mean of its items', () => {
    const { values } = reviewDocument(DOCUMENT, 0.7);
    expect(values).toEqual([
      {
        section: 'core',
        name: 'reference',
        confidence: 0.5,
        page: 2,
        quote: 'Ref SYN-1',
        manual: false,
        doubtful: true,
        confirmable: true,
      },
      {
        section: 'core',
        name: 'issuer',
        confidence: 0.99,
        page: null,
        quote: null,
        manual: false,
        doubtful: false,
        confirmable: true,
      },
      {
        section: 'core',
        name: 'amount',
        confidence: null,
        page: null,
        quote: null,
        manual: true,
        doubtful: false,
        confirmable: true,
      },
      {
        section: 'core',
        name: 'key_dates',
        confidence: 0.8,
        page: 1,
        quote: 'on 1 January 2026',
        manual: false,
        doubtful: false,
        confirmable: false,
      },
      {
        section: 'fields',
        name: 'meter_ids',
        confidence: 0.5,
        page: 1,
        quote: 'meter M-1',
        manual: false,
        doubtful: true,
        confirmable: true,
      },
      {
        section: 'fields',
        name: 'note',
        confidence: null,
        page: null,
        quote: null,
        manual: false,
        doubtful: true,
        confirmable: true,
      },
    ]);
  });

  it('gives the reasons of the flag, by the rule that settled the document', () => {
    expect(reviewDocument(DOCUMENT, 0.7)).toMatchObject({
      threshold: 0.7,
      reasons: ['low_confidence', 'rejected_values'],
      rejected_values: 2,
      type: { confidence: 0.95, outcome: 'existing', manual: false, doubtful: false },
    });
    expect(reviewDocument(DOCUMENT, 0.4).reasons).toEqual(['rejected_values']);
  });

  it.each([
    ['fallback', 'type_fallback'],
    ['untyped', 'type_untyped'],
  ] as const)('flags a document that got the %s outcome', (outcome, reason) => {
    const document = {
      ...DOCUMENT,
      confidence: 0.9,
      provenance: { '@pipeline': { type: { ...EXISTING, outcome } } },
    };
    const review = reviewDocument(document, 0.7);
    expect(review.reasons).toEqual([reason]);
    expect(review.type).toEqual({ confidence: 0.95, outcome, manual: false, doubtful: true });
  });

  it('says a type chosen by hand waits for its extraction, and a re-extraction failed', () => {
    const document = {
      ...DOCUMENT,
      confidence: null,
      error: 'reextraction_failed',
      provenance: { '@pipeline': { type: { manual: true } } },
    };
    const review = reviewDocument(document, 0.7);
    expect(review.reasons).toEqual(['type_pending_extraction', 'reextraction_failed']);
    expect(review.type).toEqual({ confidence: null, outcome: null, manual: true, doubtful: false });
  });

  it('gives no settlement reason for a document still on its way', () => {
    const review = reviewDocument({ ...DOCUMENT, status: 'classified', confidence: null }, 0.7);
    expect(review.reasons).toEqual(['rejected_values']);
  });

  it('marks a list manual only when every item is, and weighs a manual item at 1', () => {
    const document = {
      ...DOCUMENT,
      fields: { meter_ids: ['M-1', 'M-2'] },
      provenance: { meter_ids: [{ manual: true }, extracted(0.9, 'meter M-2')] },
    };
    expect(reviewDocument(document, 0.7).values.at(-1)).toMatchObject({
      manual: false,
      confidence: 0.95,
      doubtful: false,
    });
  });
});
