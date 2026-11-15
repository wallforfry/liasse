import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { notSnakeCase, wireKeyPaths } from './casing.ts';
import * as contract from './index.ts';

// The inputs the knowledge layer parses in-process. They never travel: the transports take
// the snake_case `*OptionsSchema` derived from them.
const IN_PROCESS = new Set(['timelineInputSchema', 'recallInputSchema', 'getSubjectInputSchema']);

const schemas = Object.entries(contract).flatMap(([name, value]) =>
  value instanceof z.ZodType ? [{ name, schema: value }] : [],
);

describe('the wire casing of the contract', () => {
  it('spells every key of a request or an answer in snake_case', () => {
    const travelling = schemas.filter(({ name }) => !IN_PROCESS.has(name));
    expect(travelling.length).toBeGreaterThan(30);
    const offending = travelling.flatMap(({ name, schema }) =>
      [...new Set([...wireKeyPaths(schema, 'output'), ...wireKeyPaths(schema, 'input')])].map(
        (path) => `${name}${path}`,
      ),
    );
    expect(notSnakeCase(offending)).toEqual([]);
  });

  it('exempts only in-process inputs that do hold a camelCase key', () => {
    const exempted = schemas.filter(({ name }) => IN_PROCESS.has(name));
    expect(exempted.map(({ name }) => name).toSorted()).toEqual([...IN_PROCESS].toSorted());
    for (const { schema } of exempted) {
      expect(notSnakeCase(wireKeyPaths(schema, 'input'))).not.toEqual([]);
    }
  });
});
