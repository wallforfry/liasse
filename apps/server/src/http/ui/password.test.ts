import type { Argon2idHash } from '@liasse/core/config';
import { createGate, sleep } from '@liasse/core/testing';
import { describe, expect, it } from 'vitest';
import { type Argon2idHasher, createPasswordCheck } from './password.ts';

const EXPECTED: Argon2idHash = {
  kind: 'argon2id',
  memorySize: 64,
  iterations: 1,
  parallelism: 1,
  salt: new Uint8Array(16),
  hash: new Uint8Array(32).fill(1),
};

/** A hasher whose computations stay in flight until the gate opens. */
const heldHasher = () => {
  const gate = createGate();
  const presented: string[] = [];
  const hash: Argon2idHasher = async (password) => {
    presented.push(password);
    await gate.opened;
    return password === 'synthetic-right' ? EXPECTED.hash : new Uint8Array(32);
  };
  return { gate, presented, hash };
};

describe('createPasswordCheck', () => {
  it('compares a plain password', async () => {
    const check = createPasswordCheck({ kind: 'plain', value: 'synthetic-right' });
    expect(await check('synthetic-right')).toBe('match');
    expect(await check('synthetic-wrong')).toBe('mismatch');
  });

  it('computes at most two argon2id hashes at once and answers the others busy', async () => {
    const held = heldHasher();
    const check = createPasswordCheck(EXPECTED, { hash: held.hash });
    const first = check('synthetic-right');
    const second = check('synthetic-wrong');
    // Bounded, so a missing cap fails at once instead of waiting on the held hashes.
    expect(await Promise.race([check('synthetic-third'), sleep(5000).then(() => 'held')])).toBe(
      'busy',
    );
    expect(held.presented).toEqual(['synthetic-right', 'synthetic-wrong']);
    held.gate.open();
    expect(await Promise.all([first, second])).toEqual(['match', 'mismatch']);
    expect(await check('synthetic-right')).toBe('match');
  });

  it('frees its slot when the hash fails', async () => {
    const check = createPasswordCheck(EXPECTED, {
      maxInFlight: 1,
      hash: () => Promise.reject(new Error('synthetic failure')),
    });
    await expect(check('synthetic-right')).rejects.toThrow('synthetic failure');
    await expect(check('synthetic-right')).rejects.toThrow('synthetic failure');
  });
});
