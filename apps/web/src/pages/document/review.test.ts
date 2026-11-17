import type { DocumentReview, DocumentView, ReviewedValue } from '@liasse/sdk';
import { describe, expect, it } from 'vitest';
import {
  draftOfReview,
  otherValues,
  readAgainOf,
  readReview,
  reasonSentences,
  reclassificationOf,
  reviewedValues,
} from './review.ts';

const DOCUMENT: DocumentView = {
  id: 'doc_01SYNTHETIC',
  status: 'needs_review',
  state: 'current',
  type: 'invoice',
  title: 'Synthetic invoice',
  summary: null,
  mime: 'application/pdf',
  original_name: 'invoice.pdf',
  source: 'api',
  private: false,
  confidence: 0.42,
  error: null,
  core: { reference: 'SYN-1', iban: 'FR76 **** 1234', key_dates: [{ date: '2026-01-01' }] },
  ingested_at: '2026-11-15T10:00:00.000Z',
  updated_at: '2026-11-15T10:00:00.000Z',
  schema_version: 1,
  hint: null,
  analysis_pending: false,
  fields: { amount: 12.5, note: 'Synthetic note' },
};

const value = (
  section: ReviewedValue['section'],
  name: string,
  doubtful: boolean,
  confirmable = true,
): ReviewedValue => ({
  section,
  name,
  confidence: doubtful ? 0.4 : 0.9,
  page: 1,
  quote: 'q',
  manual: false,
  doubtful,
  confirmable,
});

const REVIEW: DocumentReview = {
  threshold: 0.7,
  reasons: ['low_confidence', 'rejected_values'],
  rejected_values: 1,
  rejections: [],
  type: { confidence: 0.9, outcome: 'existing', manual: false, doubtful: false },
  values: [
    value('core', 'reference', true),
    value('core', 'iban', true),
    value('core', 'key_dates', true, false),
    value('fields', 'amount', true),
    value('fields', 'note', false),
  ],
};

describe('the review of a document', () => {
  it('asks about the doubtful values a correction can confirm, and shows the others', () => {
    expect(reviewedValues(REVIEW).map(({ name }) => name)).toEqual(['reference', 'iban', 'amount']);
    expect(otherValues(REVIEW).map(({ name }) => name)).toEqual(['key_dates', 'note']);
  });

  it('confirms every value and vouches for the type when everything is accepted', () => {
    expect(readReview(draftOfReview(DOCUMENT), DOCUMENT, REVIEW)).toEqual({
      ok: true,
      correction: {
        type: 'invoice',
        confirm: { reference: 'SYN-1', iban: 'FR76 **** 1234', amount: 12.5 },
      },
    });
  });

  it('clears a rejected value and sets an edited one', () => {
    const draft = {
      type: 'invoice',
      reanalysis: null,
      decisions: {
        'core.reference': { kind: 'edit', text: 'SYN-2' },
        'fields.amount': { kind: 'edit', text: '13.5' },
        'core.iban': { kind: 'reject' },
      },
    } as const;
    expect(readReview(draft, DOCUMENT, REVIEW)).toEqual({
      ok: true,
      correction: {
        type: 'invoice',
        core: { reference: 'SYN-2', iban: null },
        fields: { amount: 13.5 },
      },
    });
  });

  it('leaves the fields out when the type changes: they are extracted again for it', () => {
    const draft = {
      type: 'receipt',
      reanalysis: null,
      decisions: { 'fields.amount': { kind: 'reject' }, 'core.iban': { kind: 'reject' } },
    } as const;
    expect(readReview(draft, DOCUMENT, REVIEW)).toEqual({
      ok: true,
      correction: { type: 'receipt', confirm: { reference: 'SYN-1' }, core: { iban: null } },
    });
  });

  it('refuses a review without a type, or with an edit that cannot be read', () => {
    const untyped = { ...DOCUMENT, type: null };
    expect(readReview(draftOfReview(untyped), untyped, REVIEW)).toEqual({
      ok: false,
      problem: 'Choose a type for the document.',
    });
    const badJson = {
      type: 'invoice',
      reanalysis: null,
      decisions: { 'fields.amount': { kind: 'edit', text: '{' } },
    } as const;
    expect(readReview(badJson, DOCUMENT, REVIEW)).toEqual({
      ok: false,
      problem: 'The new value of "amount" is not valid JSON.',
    });
    const emptyText = {
      type: 'invoice',
      reanalysis: null,
      decisions: { 'core.reference': { kind: 'edit', text: ' ' } },
    } as const;
    expect(readReview(emptyText, DOCUMENT, REVIEW)).toEqual({
      ok: false,
      problem: 'Give "reference" a new value, or reject it.',
    });
  });

  it('says each reason in a sentence', () => {
    expect(reasonSentences(DOCUMENT, REVIEW)).toEqual([
      'Its confidence, 42%, is below the threshold of 70%.',
      '1 value the model read could not be checked against the text and was left out.',
    ]);
  });

  describe('asking for the type again', () => {
    const asking = (reanalysis: string) => ({ ...draftOfReview(DOCUMENT), reanalysis });

    it('sends the hint trimmed, none when it is blank, and no reclassification otherwise', () => {
      expect(reclassificationOf(asking('  A water bill '))).toEqual({ hint: 'A water bill' });
      expect(reclassificationOf(asking('  '))).toEqual({});
      expect(reclassificationOf(draftOfReview(DOCUMENT))).toBeNull();
    });

    it('reads every value again, core and fields, instead of deciding it', () => {
      const draft = asking('');
      expect(readAgainOf(value('core', 'reference', true), draft, DOCUMENT)).toBe(
        'Will be read again once the type is analysed.',
      );
      expect(readAgainOf(value('fields', 'amount', true), draft, DOCUMENT)).toBe(
        'Will be read again once the type is analysed.',
      );
      expect(
        readAgainOf(value('core', 'reference', true), draftOfReview(DOCUMENT), DOCUMENT),
      ).toBeNull();
      expect(
        readAgainOf(
          value('fields', 'amount', true),
          { ...draftOfReview(DOCUMENT), type: 'receipt' },
          DOCUMENT,
        ),
      ).toBe('Will be extracted again for the new type.');
    });
  });
});
