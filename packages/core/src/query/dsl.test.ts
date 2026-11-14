import { describe, expect, it } from 'vitest';
import {
  DEFAULT_QUERY_LIMIT,
  MAX_QUERY_CONDITIONS,
  MAX_QUERY_GROUP_BY,
  MAX_QUERY_LIMIT,
  MAX_QUERY_SELECT,
  MAX_QUERY_STRING_LENGTH,
} from '../domain/limits.ts';
import { parseQueryDsl, queryDslJsonSchema } from './dsl.ts';

const SPEC_EXAMPLE = {
  type: 'energy_bill',
  where: [
    ['core.issuer', '=', 'EDF'],
    ['core.document_date', '>=', '2026-01-01'],
    ['fields.consumption_kwh', '>', 300],
  ],
  order_by: ['core.document_date', 'desc'],
  aggregate: { sum: 'core.amount.value' },
  limit: 50,
};

const errorsOf = (input: unknown) => {
  const parsed = parseQueryDsl(input);
  if (parsed.ok) throw new Error('The query was accepted');
  return parsed.error;
};

const repeat = <Item>(length: number, item: Item): readonly Item[] =>
  Array.from({ length }, () => item);

describe('the query DSL', () => {
  it('accepts the example of the specification and fills the defaults', () => {
    expect(parseQueryDsl(SPEC_EXAMPLE)).toEqual({
      ok: true,
      value: { ...SPEC_EXAMPLE, offset: 0, include_private: false },
    });
    expect(parseQueryDsl({})).toEqual({
      ok: true,
      value: { where: [], limit: DEFAULT_QUERY_LIMIT, offset: 0, include_private: false },
    });
  });

  it('refuses an unknown key and names the ones it takes', () => {
    expect(errorsOf({ filter: [], sql: 'SELECT 1' })).toEqual([
      {
        code: 'invalid_query',
        path: [],
        message:
          'Unknown keys "filter", "sql". Expected: type, where, select, order_by, aggregate, group_by, limit, offset, include_private.',
      },
    ]);
    expect(errorsOf({ aggregate: { median: 'core.amount.value' } })).toEqual([
      {
        code: 'invalid_query',
        path: ['aggregate'],
        message: 'Unknown key "median". Expected: count, sum, min, max, avg.',
      },
    ]);
  });

  it('refuses an unknown operator or direction and names the ones that exist', () => {
    expect(errorsOf({ where: [['title', 'like', 'x']] })).toEqual([
      {
        code: 'invalid_query',
        path: ['where', 0, 1],
        message:
          'Unknown operator "like". Expected one of: =, !=, <, <=, >, >=, in, contains, exists.',
      },
    ]);
    expect(errorsOf({ order_by: ['title', 'descending'] })).toEqual([
      {
        code: 'invalid_query',
        path: ['order_by', 1],
        message: 'Unknown direction "descending". Expected one of: asc, desc.',
      },
    ]);
  });

  it.each([
    ['a query that is not an object', 'SELECT 1', []],
    ['a condition without a value', { where: [['title', 'exists']] }, ['where', 0]],
    ['a condition that is not a triple', { where: ['title'] }, ['where', 0]],
    ['an empty field path', { where: [['', '=', 1]] }, ['where', 0, 0]],
    [
      'a field path over the limit',
      { where: [['x'.repeat(MAX_QUERY_STRING_LENGTH + 1), '=', 1]] },
      ['where', 0, 0],
    ],
    ['a type over the limit', { type: 'x'.repeat(MAX_QUERY_STRING_LENGTH + 1) }, ['type']],
    [
      'more conditions than the limit',
      { where: repeat(MAX_QUERY_CONDITIONS + 1, ['title', 'exists', true]) },
      ['where'],
    ],
    ['a limit of zero', { limit: 0 }, ['limit']],
    ['a limit over the maximum', { limit: MAX_QUERY_LIMIT + 1 }, ['limit']],
    ['a fractional limit', { limit: 1.5 }, ['limit']],
    ['a negative offset', { offset: -1 }, ['offset']],
    ['a fractional offset', { offset: 0.5 }, ['offset']],
    ['an empty aggregate', { aggregate: {} }, ['aggregate']],
    ['an aggregate without a field', { aggregate: { count: true } }, ['aggregate', 'count']],
    ['an empty group_by', { group_by: [] }, ['group_by']],
    ['a group_by that is not a list', { group_by: 'core.issuer' }, ['group_by']],
    [
      'more group_by paths than the limit',
      { group_by: repeat(MAX_QUERY_GROUP_BY + 1, 'title') },
      ['group_by'],
    ],
    [
      'more selected fields than the limit',
      { select: repeat(MAX_QUERY_SELECT + 1, 'title') },
      ['select'],
    ],
    ['an order_by without a direction', { order_by: ['title'] }, ['order_by']],
    ['an include_private that is not a boolean', { include_private: 'yes' }, ['include_private']],
  ])('refuses %s', (_, input, path) => {
    expect(errorsOf(input)).toMatchObject([{ code: 'invalid_query', path }]);
  });

  it('accepts each bound at its limit', () => {
    const atLimits = {
      type: 'x'.repeat(MAX_QUERY_STRING_LENGTH),
      where: repeat(MAX_QUERY_CONDITIONS, ['x'.repeat(MAX_QUERY_STRING_LENGTH), 'exists', true]),
      select: repeat(MAX_QUERY_SELECT, 'title'),
      limit: MAX_QUERY_LIMIT,
      offset: 0,
    };
    expect(parseQueryDsl(atLimits).ok).toBe(true);
    expect(
      parseQueryDsl({
        aggregate: { count: '*' },
        group_by: repeat(MAX_QUERY_GROUP_BY, 'title'),
        limit: 1,
      }).ok,
    ).toBe(true);
  });

  it('reports every problem at once, up to twenty', () => {
    expect(errorsOf({ limit: 0, offset: -1 }).map(({ path }) => path)).toEqual([
      ['limit'],
      ['offset'],
    ]);
    expect(errorsOf({ where: repeat(MAX_QUERY_CONDITIONS, ['', 'like', 1]) })).toHaveLength(20);
  });

  it('cuts the user text it echoes', () => {
    const [error] = errorsOf({ where: [['title', 'x'.repeat(500), 1]] });
    expect(error?.message).toContain(`"${'x'.repeat(60)}..."`);
    expect(error?.message.length).toBeLessThan(200);
  });

  it('renders to a JSON Schema whose every key is optional', () => {
    const schema = queryDslJsonSchema();
    expect(schema).toMatchObject({ type: 'object', additionalProperties: false });
    expect(Object.keys(schema.properties ?? {})).toEqual([
      'type',
      'where',
      'select',
      'order_by',
      'aggregate',
      'group_by',
      'limit',
      'offset',
      'include_private',
    ]);
    expect(schema.required ?? []).toEqual([]);
    expect(schema.properties?.limit).toMatchObject({
      default: DEFAULT_QUERY_LIMIT,
      minimum: 1,
      maximum: MAX_QUERY_LIMIT,
    });
  });
});
