import { describe, expect, it } from 'vitest';
import { SYNTHETIC_IBAN } from '../entities/support.test-helper.ts';
import type { LinkDocument } from './link-candidates.ts';
import type { ProposedLink } from './link-prompt.ts';
import { validateLinks } from './link-rules.ts';

const document = (id: string, overrides: Partial<LinkDocument> = {}): LinkDocument => ({
  id,
  title: `Document ${id}`,
  summary: null,
  type: null,
  statedDate: null,
  day: '2026-06-01',
  reference: null,
  amount: null,
  issuerId: null,
  subjectIds: [],
  ...overrides,
});

const proposal = (candidate: string, overrides: Partial<ProposedLink> = {}): ProposedLink => ({
  candidate,
  kind: 'supersedes',
  actor: 'document',
  confidence: 0.9,
  rationale: 'Synthetic rationale.',
  ...overrides,
});

const SOURCE = document('doc_source');
const A = document('doc_a');
const B = document('doc_b');

const triples = (links: ReturnType<typeof validateLinks>): readonly string[] =>
  links.map(
    ({ fromDocumentId, kind, toDocumentId }) => `${fromDocumentId} ${kind} ${toDocumentId}`,
  );

describe('validateLinks', () => {
  it('orients a link by the document that acts', () => {
    const links = validateLinks(
      SOURCE,
      [A, B],
      [
        proposal('doc_a', { kind: 'pays' }),
        proposal('doc_b', { kind: 'terminates', actor: 'candidate' }),
      ],
    );
    expect(triples(links)).toEqual(['doc_source pays doc_a', 'doc_b terminates doc_source']);
    expect(links[0]).toEqual({
      fromDocumentId: 'doc_source',
      toDocumentId: 'doc_a',
      kind: 'pays',
      confidence: 0.9,
      rationale: 'Synthetic rationale.',
    });
  });

  it('drops a link to a document that was not offered, and a link to the document itself', () => {
    expect(
      validateLinks(SOURCE, [A], [proposal('doc_not_offered'), proposal('doc_source')]),
    ).toEqual([]);
    expect(validateLinks(SOURCE, [A, SOURCE], [proposal('doc_source')])).toEqual([]);
  });

  it('drops a link the text model is not sure of', () => {
    const links = validateLinks(
      SOURCE,
      [A, B],
      [
        proposal('doc_a', { confidence: 0.69 }),
        proposal('doc_b', { confidence: 0.7, kind: 'amends' }),
      ],
    );
    expect(triples(links)).toEqual(['doc_source amends doc_b']);
  });

  it.each(['supersedes', 'amends', 'terminates', 'replies_to'] as const)(
    'drops a document that %s one written after it',
    (kind) => {
      const older = document('doc_older', { statedDate: '2025-01-10' });
      const newer = document('doc_newer', { statedDate: '2026-01-10' });
      expect(validateLinks(older, [newer], [proposal('doc_newer', { kind })])).toEqual([]);
      expect(triples(validateLinks(newer, [older], [proposal('doc_older', { kind })]))).toEqual([
        `doc_newer ${kind} doc_older`,
      ]);
      expect(
        triples(
          validateLinks(older, [newer], [proposal('doc_newer', { kind, actor: 'candidate' })]),
        ),
      ).toEqual([`doc_newer ${kind} doc_older`]);
    },
  );

  it('checks the order on the dates the documents state, never on the day of ingestion', () => {
    const undated = document('doc_undated', { day: '2020-01-01' });
    const dated = document('doc_dated', { statedDate: '2026-01-10', day: '2026-01-10' });
    expect(validateLinks(undated, [dated], [proposal('doc_dated')])).toHaveLength(1);
    const sameDay = document('doc_same', { statedDate: '2026-01-10' });
    expect(validateLinks(sameDay, [dated], [proposal('doc_dated')])).toHaveLength(1);
  });

  it('lets a payment come before its invoice, and an attachment have no order', () => {
    const older = document('doc_older', { statedDate: '2025-01-10' });
    const newer = document('doc_newer', { statedDate: '2026-01-10' });
    for (const kind of ['pays', 'attachment_of'] as const) {
      expect(validateLinks(older, [newer], [proposal('doc_newer', { kind })])).toHaveLength(1);
    }
  });

  it('accepts a payment of all or part of an amount, in its currency', () => {
    const bill = document('doc_bill', { amount: { value: 84.2, currency: 'EUR' } });
    const pays = (amount: LinkDocument['amount']) =>
      validateLinks(
        document('doc_payment', { amount }),
        [bill],
        [proposal('doc_bill', { kind: 'pays' })],
      ).length;
    expect(pays({ value: 84.2, currency: 'EUR' })).toBe(1);
    expect(pays({ value: 84.204, currency: 'EUR' })).toBe(1);
    expect(pays({ value: 40, currency: 'EUR' })).toBe(1);
    expect(pays({ value: -84.2, currency: 'EUR' })).toBe(1);
    expect(pays(null)).toBe(1);
    expect(pays({ value: 84.21, currency: 'EUR' })).toBe(0);
    expect(pays({ value: 842, currency: 'EUR' })).toBe(0);
    expect(pays({ value: 84.2, currency: 'USD' })).toBe(0);
  });

  it('checks amounts for a payment only', () => {
    const contract = document('doc_contract', { amount: { value: 10, currency: 'EUR' } });
    const amendment = document('doc_amendment', { amount: { value: 500, currency: 'USD' } });
    expect(
      validateLinks(amendment, [contract], [proposal('doc_contract', { kind: 'amends' })]),
    ).toHaveLength(1);
  });

  it('keeps one link of a kind between two documents, the surest, in one direction', () => {
    const links = validateLinks(
      SOURCE,
      [A],
      [
        proposal('doc_a', { confidence: 0.8 }),
        proposal('doc_a', { confidence: 0.95, actor: 'candidate' }),
        proposal('doc_a', { confidence: 0.9 }),
        proposal('doc_a', { kind: 'replies_to', confidence: 0.75 }),
      ],
    );
    expect(triples(links)).toEqual(['doc_a supersedes doc_source', 'doc_source replies_to doc_a']);
    expect(links[0]?.confidence).toBe(0.95);
  });

  it('lets a document supersede one document and be superseded by one', () => {
    const C = document('doc_c');
    const links = validateLinks(
      SOURCE,
      [A, B, C],
      [
        proposal('doc_a', { confidence: 0.8 }),
        proposal('doc_b', { confidence: 0.9 }),
        proposal('doc_c', { confidence: 0.85, actor: 'candidate' }),
        proposal('doc_a', { confidence: 0.75, actor: 'candidate' }),
        proposal('doc_a', { kind: 'pays', confidence: 0.8 }),
        proposal('doc_b', { kind: 'pays', confidence: 0.8 }),
      ],
    );
    expect(triples(links)).toEqual([
      'doc_source supersedes doc_b',
      'doc_c supersedes doc_source',
      'doc_source pays doc_a',
      'doc_source pays doc_b',
    ]);
  });

  it('masks an IBAN the model wrote in its rationale', () => {
    const [link] = validateLinks(
      SOURCE,
      [A],
      [proposal('doc_a', { kind: 'pays', rationale: `Paid from ${SYNTHETIC_IBAN}.` })],
    );
    expect(link?.rationale).toBe('Paid from ****0146.');
  });
});
