import { describe, expect, it } from 'vitest';
import { prepareMention } from './mention.ts';
import { TEST_IDENTIFIER_KEY } from './support.test-helper.ts';

describe('prepareMention', () => {
  it('drops the identifiers that are not ones, and counts them by reason', () => {
    const prepared = prepareMention(TEST_IDENTIFIER_KEY, {
      name: 'Dupont',
      identifiers: [
        { type: 'company_id', value: '5' },
        { type: 'company_id', value: 'ABCDEF' },
        { type: 'vat_number', value: 'FR' },
        { type: 'customer_number', value: ' - ' },
        { type: 'company_id', value: '999 990 001' },
        { type: 'vat_number', value: 'FR 00 999 990 001' },
        { type: 'customer_number', value: '7' },
      ],
    });
    expect(prepared.identifiers).toEqual([
      { type: 'company_id', value: '999990001' },
      { type: 'vat_number', value: 'FR00999990001' },
      { type: 'customer_number', value: '7' },
    ]);
    expect(prepared.droppedIdentifiers).toEqual({ empty: 1, malformed: 3 });
  });

  it('counts nothing for a mention whose identifiers are all kept', () => {
    expect(
      prepareMention(TEST_IDENTIFIER_KEY, {
        name: 'Dupont',
        identifiers: [{ type: 'company_id', value: '999990001' }],
      }).droppedIdentifiers,
    ).toEqual({ empty: 0, malformed: 0 });
  });
});
