import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const TOKEN_BYTES = 32;

/** The setup token of this process: only its hash is held. */
export interface SetupToken {
  readonly matches: (candidate: string) => boolean;
}

export interface IssuedSetupToken {
  /** Shown once to the operator, then dropped by the caller. */
  readonly value: string;
  readonly token: SetupToken;
}

// Both sides are hashed first, so the comparison takes the same time whatever the length
// and the content of the candidate.
const digestOf = (value: string): Buffer => createHash('sha256').update(value, 'utf8').digest();

/** A new random setup token, valid for the life of the process. */
export const issueSetupToken = (): IssuedSetupToken => {
  const value = randomBytes(TOKEN_BYTES).toString('base64url');
  const expected = digestOf(value);
  return {
    value,
    token: { matches: (candidate) => timingSafeEqual(digestOf(candidate), expected) },
  };
};
