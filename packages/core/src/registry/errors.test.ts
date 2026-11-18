import type { RegistryErrorCode } from '@liasse/contract/registry';
import { describe, expectTypeOf, it } from 'vitest';
import type { RegistryError } from './errors.ts';

describe('the failures of the registry', () => {
  it('use every code the contract lists for them, and no other', () => {
    expectTypeOf<RegistryError['code']>().toEqualTypeOf<RegistryErrorCode>();
  });
});
