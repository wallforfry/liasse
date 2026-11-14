import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  mergePayloadSchema,
  promoteFieldPayloadSchema,
  removeFieldPayloadSchema,
  stabilizePayloadSchema,
} from '../consolidation/payloads.ts';
import { mergeEntityPayloadSchema } from '../entities/proposal-store.ts';
import * as contract from './index.ts';

// The inputs the knowledge layer parses in-process. They never travel: the transports take
// the snake_case `*OptionsSchema` derived from them.
const IN_PROCESS = new Set(['timelineInputSchema', 'recallInputSchema', 'getSubjectInputSchema']);

const SNAKE_CASE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

const schemas = Object.entries(contract).flatMap(([name, value]) =>
  value instanceof z.ZodType ? [{ name, schema: value }] : [],
);

// The `payload` of a change is an open record in the contract; these schemas write it.
const CHANGE_PAYLOADS = {
  mergePayloadSchema,
  promoteFieldPayloadSchema,
  stabilizePayloadSchema,
  removeFieldPayloadSchema,
  mergeEntityPayloadSchema,
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null;

// Every property name of a JSON Schema, at any depth, as the path that leads to it.
const propertyPaths = (node: unknown, at: string): readonly string[] => {
  if (Array.isArray(node))
    return node.flatMap((item, index) => propertyPaths(item, `${at}[${String(index)}]`));
  if (!isRecord(node)) return [];
  const properties = isRecord(node.properties) ? Object.keys(node.properties) : [];
  return [
    ...properties.map((key) => `${at}.${key}`),
    ...Object.entries(node).flatMap(([key, child]) => propertyPaths(child, `${at}/${key}`)),
  ];
};

const keysOf = (schema: z.ZodType, io: 'input' | 'output'): readonly string[] =>
  propertyPaths(z.toJSONSchema(schema, { io, unrepresentable: 'any' }), '');

const notSnakeCase = (paths: readonly string[]): readonly string[] =>
  paths.filter((path) => !SNAKE_CASE.test(path.slice(path.lastIndexOf('.') + 1)));

describe('the wire casing of the contract', () => {
  it('spells every key of a request or an answer in snake_case', () => {
    const travelling = schemas.filter(({ name }) => !IN_PROCESS.has(name));
    expect(travelling.length).toBeGreaterThan(30);
    const offending = travelling.flatMap(({ name, schema }) =>
      [...new Set([...keysOf(schema, 'output'), ...keysOf(schema, 'input')])].map(
        (path) => `${name}${path}`,
      ),
    );
    expect(notSnakeCase(offending)).toEqual([]);
  });

  it('spells every key of a change payload in snake_case', () => {
    const offending = Object.entries(CHANGE_PAYLOADS).flatMap(([name, schema]) =>
      keysOf(schema, 'output').map((path) => `${name}${path}`),
    );
    expect(offending.length).toBeGreaterThan(5);
    expect(notSnakeCase(offending)).toEqual([]);
  });

  it('exempts only in-process inputs that do hold a camelCase key', () => {
    const exempted = schemas.filter(({ name }) => IN_PROCESS.has(name));
    expect(exempted.map(({ name }) => name).toSorted()).toEqual([...IN_PROCESS].toSorted());
    for (const { schema } of exempted) {
      expect(notSnakeCase(keysOf(schema, 'input'))).not.toEqual([]);
    }
  });
});
