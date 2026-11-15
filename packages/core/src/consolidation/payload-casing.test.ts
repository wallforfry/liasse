import { notSnakeCase, wireKeyPaths } from '@liasse/contract';
import { describe, expect, it } from 'vitest';
import { mergeEntityPayloadSchema } from '../entities/proposal-store.ts';
import {
  mergePayloadSchema,
  promoteFieldPayloadSchema,
  removeFieldPayloadSchema,
  stabilizePayloadSchema,
} from './payloads.ts';

// The `payload` of a change is an open record in the contract; these schemas write it.
const CHANGE_PAYLOADS = {
  mergePayloadSchema,
  promoteFieldPayloadSchema,
  stabilizePayloadSchema,
  removeFieldPayloadSchema,
  mergeEntityPayloadSchema,
};

describe('the wire casing of a change payload', () => {
  it('spells every key of a change payload in snake_case', () => {
    const offending = Object.entries(CHANGE_PAYLOADS).flatMap(([name, schema]) =>
      wireKeyPaths(schema, 'output').map((path) => `${name}${path}`),
    );
    expect(offending.length).toBeGreaterThan(5);
    expect(notSnakeCase(offending)).toEqual([]);
  });
});
