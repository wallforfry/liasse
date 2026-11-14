import { describe, expect, it } from 'vitest';
import { flagsSyntheticIdentifiers, SYNTHETIC_IDENTIFIER } from './detector.test-helper.ts';
import {
  buildRetainItem,
  retainHash,
  screenFacts,
  type SyncedDocument,
  type SyncedFact,
} from './memory.ts';

const DOCUMENT: SyncedDocument = {
  id: 'doc_SYNTHETIC',
  typeSlug: 'home_insurance_contract',
  documentDate: '2025-02-10',
};

const fact = (
  text: string,
  validFrom: string | null = null,
  validTo: string | null = null,
): SyncedFact => ({ text, validFrom, validTo });

describe('screenFacts', () => {
  it('leaves out the facts the detector flags and counts them', () => {
    const kept = fact('Kept.', '2025-03-01');
    const screened = screenFacts(
      [fact(`Paid from account ${SYNTHETIC_IDENTIFIER}.`), kept, fact(SYNTHETIC_IDENTIFIER)],
      flagsSyntheticIdentifiers,
    );
    expect(screened).toEqual({ sendable: [kept], withheld: 2 });
  });

  it('keeps every fact the detector does not flag', () => {
    const facts = [fact('First.'), fact('Second.')];
    expect(screenFacts(facts, flagsSyntheticIdentifiers)).toEqual({ sendable: facts, withheld: 0 });
  });
});

describe('buildRetainItem', () => {
  it('writes one line per fact, each citing its document and its validity', () => {
    const item = buildRetainItem(DOCUMENT, [
      fact('The synthetic contract renews every March 1st.', '2025-03-01'),
      fact('The synthetic contract covered the first flat.', '2024-03-01', '2025-02-28'),
      fact('The notice period is two months.', null, '2026-01-01'),
      fact('The insurer is a synthetic company.'),
    ]);
    expect(item?.content).toBe(
      [
        '[doc:doc_SYNTHETIC] The synthetic contract renews every March 1st. (valid_from 2025-03-01)',
        '[doc:doc_SYNTHETIC] The synthetic contract covered the first flat. (valid_from 2024-03-01, valid_to 2025-02-28)',
        '[doc:doc_SYNTHETIC] The notice period is two months. (valid_to 2026-01-01)',
        '[doc:doc_SYNTHETIC] The insurer is a synthetic company.',
      ].join('\n'),
    );
  });

  it('keeps a fact on one line', () => {
    const item = buildRetainItem(DOCUMENT, [fact('  A fact\nover\t two   lines. ')]);
    expect(item?.content).toBe('[doc:doc_SYNTHETIC] A fact over two lines.');
  });

  it('identifies the memory by the document and describes it for an agent', () => {
    const item = buildRetainItem(DOCUMENT, [
      fact('First.', '2025-03-01', '2025-12-31'),
      fact('Second.', '2024-03-01', '2026-06-30'),
    ]);
    expect(item).toEqual({
      content:
        '[doc:doc_SYNTHETIC] First. (valid_from 2025-03-01, valid_to 2025-12-31)\n' +
        '[doc:doc_SYNTHETIC] Second. (valid_from 2024-03-01, valid_to 2026-06-30)',
      document_id: 'doc_SYNTHETIC',
      context: 'Facts extracted from a document by Liasse',
      metadata: {
        source: 'liasse',
        document_id: 'doc_SYNTHETIC',
        type: 'home_insurance_contract',
        document_date: '2025-02-10',
        valid_from: '2024-03-01',
        valid_to: '2026-06-30',
      },
      timestamp: '2025-02-10T00:00:00Z',
    });
  });

  it('leaves out what the document does not have', () => {
    const item = buildRetainItem(
      { id: 'doc_SYNTHETIC', typeSlug: undefined, documentDate: undefined },
      [fact('Undated.')],
    );
    expect(item).toEqual({
      content: '[doc:doc_SYNTHETIC] Undated.',
      document_id: 'doc_SYNTHETIC',
      context: 'Facts extracted from a document by Liasse',
      metadata: { source: 'liasse', document_id: 'doc_SYNTHETIC' },
    });
  });

  it('gives no end of validity when one fact has none', () => {
    const item = buildRetainItem(DOCUMENT, [
      fact('Ended.', '2025-03-01', '2025-12-31'),
      fact('Still holds.', '2024-03-01'),
    ]);
    expect(item?.metadata).toMatchObject({ valid_from: '2024-03-01' });
    expect(item?.metadata).not.toHaveProperty('valid_to');
  });

  it('has nothing to retain without a fact', () => {
    expect(buildRetainItem(DOCUMENT, [])).toBeUndefined();
  });
});

describe('retainHash', () => {
  const target = { url: 'http://127.0.0.1:8888', bank: 'documents' };
  const item = buildRetainItem(DOCUMENT, [fact('A fact.')]);
  if (item === undefined) throw new Error('Expected an item');

  it('is the same for the same item in the same bank', () => {
    const again = buildRetainItem({ ...DOCUMENT }, [fact('A fact.')]);
    expect(again && retainHash({ ...target }, again)).toBe(retainHash(target, item));
    expect(retainHash(target, item)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes with the content, the metadata, the bank and the server', () => {
    const hashes = [
      retainHash(target, item),
      retainHash(target, { ...item, content: `${item.content} ` }),
      retainHash(target, { ...item, metadata: { ...item.metadata, type: 'other_type' } }),
      retainHash({ ...target, bank: 'other' }, item),
      retainHash({ ...target, url: 'http://127.0.0.1:8889' }, item),
    ];
    expect(new Set(hashes).size).toBe(hashes.length);
  });
});
