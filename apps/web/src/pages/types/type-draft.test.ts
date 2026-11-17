import { describe, expect, it } from 'vitest';
import { fieldsOf } from './field-drafts.ts';
import { draftOf, NO_PARENT } from './type-draft.ts';

describe('a drafted type', () => {
  it('fills the form, and leaves out an enum whose value holds a comma', () => {
    const { draft, leftOut } = draftOf({
      slug: 'payslip',
      description: 'Pay statement',
      parent_slug: null,
      fields: {
        gross_pay: { type: 'money' },
        site: { type: 'enum', values: ['Lyon, Part-Dieu', 'Paris'] },
        sites: { type: 'list', items: { type: 'enum', values: ['a,b'] } },
        contract: { type: 'enum', values: ['permanent', 'fixed_term'] },
      },
    });

    expect(leftOut).toEqual(['site', 'sites']);
    expect(draft.parent).toBe(NO_PARENT);
    expect(draft.fields.map(({ key }) => key)).toEqual([0, 1]);
    expect(fieldsOf(draft.fields)).toEqual({
      gross_pay: { type: 'money' },
      contract: { type: 'enum', values: ['permanent', 'fixed_term'] },
    });
  });
});
