import { describe, expect, it } from 'vitest';
import { MAX_FIELDS_PER_TYPE, MAX_QUERY_LISTED_FIELDS } from '../domain/limits.ts';
import { editDistance } from './closest.ts';
import { queryFields } from './fields.ts';
import { findField } from './find-field.ts';

const BILL = {
  fields: {
    consumption_kwh: { type: 'number' },
    deposit: { type: 'money' },
    coverage: { type: 'period' },
    parties: { type: 'list', items: { type: 'entity' } },
  },
} as const;

const listing = (fields: ReturnType<typeof queryFields>) =>
  fields.map(({ path, primitive }) => `${path}: ${primitive}`);

const unknown = (path: string, fields = queryFields(BILL)) => {
  const found = findField(fields, path, ['where', 0, 0]);
  if (found.ok) throw new Error('The field exists');
  const [error] = found.error;
  if (error?.code !== 'unknown_field') throw new Error('Not an unknown field');
  return error;
};

describe('the fields a query may address', () => {
  it('lists the document columns, the core and its parts when no type is given', () => {
    expect(listing(queryFields())).toEqual([
      'id: identifier',
      'type: identifier',
      'title: text',
      'status: enum',
      'state: enum',
      'ingested_at: date',
      'confidence: number',
      'private: boolean',
      'core.document_date: date',
      'core.issuer: entity',
      'core.recipient: entity',
      'core.amount: money',
      'core.amount.value: number',
      'core.amount.currency: text',
      'core.period: period',
      'core.period.start: date',
      'core.period.end: date',
      'core.due_date: date',
      'core.reference: text',
      'core.language: enum',
      'core.key_dates: key_dates',
    ]);
  });

  it('adds the fields of the type and the parts of its amounts and periods', () => {
    const fields = queryFields(BILL);
    expect(listing(fields).slice(queryFields().length)).toEqual([
      'fields.consumption_kwh: number',
      'fields.deposit: money',
      'fields.deposit.value: number',
      'fields.deposit.currency: text',
      'fields.coverage: period',
      'fields.coverage.start: date',
      'fields.coverage.end: date',
      'fields.parties: list',
    ]);
    const byPath = new Map(fields.map((field) => [field.path, field]));
    expect(byPath.get('fields.deposit.value')?.currency).toBe('fields.deposit.currency');
    expect(byPath.get('fields.deposit.currency')?.currency).toBeUndefined();
    expect(byPath.get('fields.coverage.start')?.currency).toBeUndefined();
    expect(byPath.get('fields.parties')?.items).toBe('entity');
    expect(byPath.get('fields.deposit')?.parts).toEqual(['value', 'currency']);
  });

  it('finds a field by its exact path only', () => {
    expect(findField(queryFields(BILL), 'fields.deposit.value', [])).toMatchObject({
      ok: true,
      value: { path: 'fields.deposit.value', primitive: 'number' },
    });
    expect(findField(queryFields(BILL), 'fields.deposit.value.cents', []).ok).toBe(false);
    expect(findField(queryFields(BILL), 'Title', []).ok).toBe(false);
    expect(findField(queryFields(BILL), 'constructor', []).ok).toBe(false);
  });

  it('answers an unknown field with the available ones and their primitives, closest first', () => {
    const error = unknown('core.amount.curency', queryFields());
    expect(error).toMatchObject({
      code: 'unknown_field',
      path: ['where', 0, 0],
      field: 'core.amount.curency',
      suggestion: 'core.amount.currency',
      truncated: false,
    });
    expect(error.available).toHaveLength(queryFields().length);
    expect(error.available.slice(0, 2)).toEqual([
      { path: 'core.amount.currency', primitive: 'text' },
      { path: 'core.amount.value', primitive: 'number' },
    ]);
    expect(error.message).toBe(
      'Unknown field "core.amount.curency". The closest one is in "suggestion". The fields that exist are in "available", closest first.',
    );
  });

  it('suggests a path whose namespace was forgotten, and nothing for a far name', () => {
    expect(unknown('amount').suggestion).toBe('core.amount');
    expect(unknown('consumption_kwh').suggestion).toBe('fields.consumption_kwh');
    expect(unknown('core.documnt_date').suggestion).toBe('core.document_date');
    const far = unknown('zzzzzzzzzzzzzzzzzzzzzzzz');
    expect(far.suggestion).toBeUndefined();
    expect(far.message).not.toContain('"suggestion"');
  });

  it('says that type fields need a type, only when none is in reach', () => {
    const hint = 'No type field exists here: give a "type" that defines it.';
    expect(unknown('fields.consumption_kwh', queryFields()).message).toContain(hint);
    expect(unknown('fields.consumption', queryFields(BILL)).message).not.toContain(hint);
    expect(unknown('core.nope', queryFields()).message).not.toContain(hint);
  });

  it('bounds the listing and says how many fields it leaves out', () => {
    const wide = queryFields({
      fields: Object.fromEntries(
        Array.from({ length: MAX_FIELDS_PER_TYPE }, (_, index) => [
          `field_${String(index)}`,
          { type: 'text' } as const,
        ]),
      ),
    });
    expect(wide).toHaveLength(51);
    const error = unknown('fields.field_x', wide);
    expect(error.available).toHaveLength(MAX_QUERY_LISTED_FIELDS);
    expect(error.truncated).toBe(true);
    expect(error.message).toMatch(/closest first; 11 more are left out\.$/);
    expect(error.available[0]?.path).toMatch(/^fields\.field_\d$/);
    const exact = unknown('nope', wide.slice(0, MAX_QUERY_LISTED_FIELDS));
    expect(exact.truncated).toBe(false);
    expect(exact.message).not.toContain('left out');
  });

  it('cuts an unknown path wherever it echoes it', () => {
    const error = unknown('x'.repeat(200));
    expect(error.message).toContain(`"${'x'.repeat(60)}..."`);
    expect(error.field).toBe(`${'x'.repeat(60)}...`);
    expect(unknown('x'.repeat(60)).field).toBe('x'.repeat(60));
  });

  it.each([
    ['', '', 0],
    ['abc', '', 3],
    ['', 'abc', 3],
    ['kitten', 'sitting', 3],
    ['flaw', 'lawn', 2],
    ['core.amount', 'core.amount', 0],
    ['amount', 'amuont', 2],
  ])('measures the edit distance from %j to %j as %d', (left, right, distance) => {
    expect(editDistance(left, right)).toBe(distance);
  });
});
