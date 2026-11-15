import { randomBytes } from 'node:crypto';

export const ID_PREFIXES = {
  document: 'doc',
  chunk: 'chk',
  docType: 'typ',
  entity: 'ent',
  typeChange: 'chg',
  job: 'job',
  documentDate: 'dat',
  documentLink: 'lnk',
  subject: 'sub',
  fact: 'fct',
  documentEvent: 'evt',
  user: 'usr',
  session: 'ses',
  account: 'acc',
  verification: 'ver',
  rateLimit: 'rlm',
  apiKey: 'key',
  signingKey: 'jwk',
  oauthClient: 'ocl',
  oauthResource: 'ors',
  oauthClientResource: 'ocr',
  oauthRefreshToken: 'ort',
  oauthAccessToken: 'oat',
  oauthConsent: 'ocn',
  oauthClientAssertion: 'oca',
} as const;
export type IdPrefix = (typeof ID_PREFIXES)[keyof typeof ID_PREFIXES];

const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const TIME_LENGTH = 10;
const RANDOM_LENGTH = 16;
const RANDOM_BITS = 80n;
const RANDOM_MAX = (1n << RANDOM_BITS) - 1n;

const encodeBase32 = (value: bigint, length: number): string =>
  Array.from({ length }, (_, position) => {
    const shift = BigInt((length - 1 - position) * 5);
    return CROCKFORD_ALPHABET.charAt(Number((value >> shift) & 31n));
  }).join('');

const randomPart = (): bigint => BigInt(`0x${randomBytes(10).toString('hex')}`);

interface UlidState {
  readonly time: number;
  readonly random: bigint;
}

const nextState = (previous: UlidState, now: number): UlidState => {
  if (now > previous.time) return { time: now, random: randomPart() };
  if (previous.random === RANDOM_MAX) return { time: previous.time + 1, random: randomPart() };
  return { time: previous.time, random: previous.random + 1n };
};

export type UlidGenerator = () => string;

export const createUlidGenerator = (clock: () => number = Date.now): UlidGenerator => {
  // ULIDs minted within one millisecond must stay sortable, which needs the last value.
  let state: UlidState = { time: -1, random: 0n };
  return () => {
    state = nextState(state, clock());
    return (
      encodeBase32(BigInt(state.time), TIME_LENGTH) + encodeBase32(state.random, RANDOM_LENGTH)
    );
  };
};

const defaultUlid = createUlidGenerator();

export const newId = <P extends IdPrefix>(prefix: P): `${P}_${string}` =>
  `${prefix}_${defaultUlid()}`;

const ULID_PATTERN = new RegExp(
  `^[${CROCKFORD_ALPHABET}]{${String(TIME_LENGTH + RANDOM_LENGTH)}}$`,
);

export const isId = <P extends IdPrefix>(prefix: P, value: string): value is `${P}_${string}` =>
  value.startsWith(`${prefix}_`) && ULID_PATTERN.test(value.slice(prefix.length + 1));
