import type { DocumentView } from '@liasse/sdk';
import { describe, expect, it } from 'vitest';
import { readCorrection, valueRowsOf } from './correction.ts';

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
  core: {
    issuer: 'Synthetic Power',
    iban: 'FR76 **** 1234',
    amount: { value: 12.5, currency: 'EUR' },
  },
  ingested_at: '2026-11-15T10:00:00.000Z',
  updated_at: '2026-11-15T10:00:00.000Z',
  schema_version: 1,
  hint: null,
  analysis_pending: false,
  fields: { pages: 2, tags: ['a'] },
  manual_fields: ['issuer'],
};

const DEFINITIONS = {
  pages: { type: 'number' },
  plan: { type: 'enum', values: ['basic', 'peak'] },
  tags: { type: 'list', items: { type: 'text' } },
} as const;

const ROWS = valueRowsOf(DOCUMENT, DEFINITIONS);

describe('valueRowsOf', () => {
  it('lists every core field and core value, then every field of the type and with a value', () => {
    expect(ROWS.map(({ key, editor, manual }) => [key, editor.kind, manual])).toEqual([
      ['core.document_date', 'date', false],
      ['core.issuer', 'text', true],
      ['core.recipient', 'text', false],
      ['core.amount', 'money', false],
      ['core.period', 'period', false],
      ['core.due_date', 'date', false],
      ['core.reference', 'text', false],
      ['core.language', 'enum', false],
      ['core.iban', 'text', false],
      ['fields.pages', 'number', false],
      ['fields.plan', 'enum', false],
      ['fields.tags', 'json', false],
    ]);
  });

  it('guesses the editor of a field the type does not describe from its value', () => {
    const rows = valueRowsOf({ ...DOCUMENT, fields: { due: '2026-12-01' } }, undefined);
    expect(rows.find(({ name }) => name === 'due')?.editor).toEqual({ kind: 'date' });
  });
});

describe('readCorrection', () => {
  it('sends only what the person changed, never a masked value sent back', () => {
    const drafts = {
      'core.issuer': { kind: 'single', text: 'Synthetic Energy' },
      'core.iban': { kind: 'single', text: 'FR76 **** 1234' },
      'fields.pages': { kind: 'single', text: '3' },
    } as const;
    expect(readCorrection(ROWS, drafts)).toEqual({
      ok: true,
      correction: { core: { issuer: 'Synthetic Energy' }, fields: { pages: 3 } },
    });
  });

  it('clears an emptied value, and fills a field the document had no value for', () => {
    const drafts = {
      'core.amount': { kind: 'money', amount: '', currency: '' },
      'fields.plan': { kind: 'single', text: 'peak' },
    } as const;
    expect(readCorrection(ROWS, drafts)).toEqual({
      ok: true,
      correction: { core: { amount: null }, fields: { plan: 'peak' } },
    });
  });

  it('refuses drafts that change nothing, and names each value it cannot read', () => {
    const back = { 'fields.pages': { kind: 'single', text: '2' } } as const;
    expect(readCorrection(ROWS, back)).toEqual({
      ok: false,
      problems: ['Nothing differs from the values shown.'],
    });
    const wrong = {
      'fields.pages': { kind: 'single', text: 'two' },
      'fields.tags': { kind: 'single', text: '[' },
    } as const;
    expect(readCorrection(ROWS, wrong)).toEqual({
      ok: false,
      problems: ['pages: expected a number', 'tags: expected valid JSON'],
    });
  });
});
