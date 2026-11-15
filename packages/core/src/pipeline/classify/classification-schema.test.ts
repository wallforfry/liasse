import { describe, expect, it } from 'vitest';
import { classificationSchema } from './classification-schema.ts';

const NEW_TYPE = { slug: 'energy_bill', description: 'An energy bill.', fields: {} };

describe('classificationSchema with offered types', () => {
  const schema = classificationSchema(['energy_bill', 'payslip']);

  it('reads an existing type, whatever the members of a new one hold', () => {
    expect(
      schema.parse({
        decision: 'existing',
        slug: 'payslip',
        confidence: 0.9,
        new_type: null,
        justification: null,
      }),
    ).toEqual({ decision: 'existing', slug: 'payslip', confidence: 0.9 });
  });

  it('reads a new type', () => {
    expect(
      schema.parse({
        decision: 'new',
        new_type: NEW_TYPE,
        confidence: 0.7,
        justification: 'None fits.',
        slug: null,
      }),
    ).toEqual({
      decision: 'new',
      new_type: NEW_TYPE,
      confidence: 0.7,
      justification: 'None fits.',
    });
  });

  it.each([
    [{ decision: 'existing', confidence: 0.9 }, 'slug'],
    [{ decision: 'existing', slug: 'invoice', confidence: 0.9 }, 'slug'],
    [{ decision: 'new', confidence: 0.7, justification: 'None fits.' }, 'new_type'],
    [{ decision: 'new', new_type: NEW_TYPE, confidence: 0.7 }, 'justification'],
  ])('refuses %j, naming %s', (output, key) => {
    const parsed = schema.safeParse(output);
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map(({ path }) => path.join('.'))).toContain(key);
  });
});

describe('classificationSchema without offered types', () => {
  it('reads a new type only', () => {
    const schema = classificationSchema([]);
    expect(
      schema.safeParse({ decision: 'existing', slug: 'energy_bill', confidence: 0.9 }).success,
    ).toBe(false);
    expect(
      schema.parse({ decision: 'new', new_type: NEW_TYPE, confidence: 0.7, justification: 'x' }),
    ).toMatchObject({ decision: 'new' });
  });
});
