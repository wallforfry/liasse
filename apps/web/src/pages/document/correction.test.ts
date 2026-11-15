import type { DocumentView } from '@liasse/sdk';
import { describe, expect, it } from 'vitest';
import { draftOf, readCorrection } from './correction.ts';

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
  confidence: 0.4,
  error: null,
  core: { issuer: 'Synthetic Power', iban: 'FR76 **** 1234' },
  ingested_at: '2026-11-15T10:00:00.000Z',
  updated_at: '2026-11-15T10:00:00.000Z',
  schema_version: 1,
  hint: null,
  fields: { amount: 12.5 },
};

describe('readCorrection', () => {
  it('sends only what the person changed, never a masked value sent back', () => {
    const draft = draftOf(DOCUMENT);
    const core = JSON.stringify({ issuer: 'Synthetic Energy', iban: 'FR76 **** 1234' });
    expect(readCorrection({ ...draft, core, private: true }, DOCUMENT)).toEqual({
      ok: true,
      correction: { private: true, core: { issuer: 'Synthetic Energy' } },
    });
  });

  it('clears a value removed from the text', () => {
    const reading = readCorrection({ ...draftOf(DOCUMENT), fields: '{}' }, DOCUMENT);
    expect(reading).toEqual({ ok: true, correction: { fields: { amount: null } } });
  });

  it('refuses a draft that changes nothing or is not a JSON object', () => {
    expect(readCorrection(draftOf(DOCUMENT), DOCUMENT)).toEqual({
      ok: false,
      problem: 'Nothing differs from the values shown.',
    });
    expect(readCorrection({ ...draftOf(DOCUMENT), core: '[1]' }, DOCUMENT)).toEqual({
      ok: false,
      problem: 'Core values must be a JSON object.',
    });
    expect(readCorrection({ ...draftOf(DOCUMENT), fields: '{' }, DOCUMENT)).toEqual({
      ok: false,
      problem: 'Fields are not valid JSON.',
    });
  });
});
