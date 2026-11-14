import { createHmac, hkdfSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { deriveIdentifierKey } from '../entities/sensitive.ts';
import { createFileUrls, FILE_URL_TTL_MS, type FileUrlGrant } from './file-url.ts';

const SECRET = 'synthetic-file-url-secret-0123456789';
const DOCUMENT = 'doc_01JC0000000000000000000000';
const OTHER_DOCUMENT = 'doc_01JC0000000000000000000001';
const START = 1_800_000_000_000;

const signer = (clock: { now: number }, secret = SECRET) =>
  createFileUrls({ secret, publicUrl: 'https://liasse.example.com', now: () => clock.now });

const grantOf = (url: string): FileUrlGrant => {
  const { pathname, searchParams } = new URL(url);
  return {
    documentId: decodeURIComponent(pathname.split('/')[2] ?? ''),
    expires: searchParams.get('expires') ?? '',
    signature: searchParams.get('signature') ?? '',
  };
};

describe('signed file URLs', () => {
  it('builds the URL from the public origin, the id, the expiry and the signature only', () => {
    const url = new URL(signer({ now: START }).sign(DOCUMENT));
    expect(url.origin).toBe('https://liasse.example.com');
    expect(url.pathname).toBe(`/documents/${DOCUMENT}/file`);
    expect([...url.searchParams.keys()]).toEqual(['expires', 'signature']);
    expect(url.searchParams.get('expires')).toBe(String((START + FILE_URL_TTL_MS) / 1000));
  });

  it('accepts its own grant, any number of times, until it expires', () => {
    const clock = { now: START };
    const urls = signer(clock);
    const grant = grantOf(urls.sign(DOCUMENT));
    expect(urls.verify(grant)).toBe(true);
    expect(urls.verify(grant)).toBe(true);
    clock.now = START + FILE_URL_TTL_MS - 1;
    expect(urls.verify(grant)).toBe(true);
    clock.now = START + FILE_URL_TTL_MS;
    expect(urls.verify(grant)).toBe(false);
  });

  it('refuses a grant moved to another document', () => {
    const urls = signer({ now: START });
    const grant = grantOf(urls.sign(DOCUMENT));
    expect(urls.verify({ ...grant, documentId: OTHER_DOCUMENT })).toBe(false);
  });

  it('refuses a grant whose expiry was pushed back', () => {
    const urls = signer({ now: START });
    const grant = grantOf(urls.sign(DOCUMENT));
    expect(urls.verify({ ...grant, expires: String(Number(grant.expires) + 1) })).toBe(false);
  });

  it.each(['', 'AAAA', 'not-a-signature', 'a'.repeat(4096)])(
    'refuses the signature %j',
    (signature) => {
      const urls = signer({ now: START });
      expect(urls.verify({ ...grantOf(urls.sign(DOCUMENT)), signature })).toBe(false);
    },
  );

  it('refuses a grant signed with another secret', () => {
    const forged = grantOf(
      signer({ now: START }, 'another-synthetic-secret-0123456789').sign(DOCUMENT),
    );
    expect(signer({ now: START }).verify(forged)).toBe(false);
  });

  // `Number` reads all of these as a number in the future: only plain digits are an expiry.
  it.each(['1e99', '0x7fffffffffff', ' 99999999999', '99999999999.5', '+99999999999', 'Infinity'])(
    'refuses the expiry %j even with a signature made for it',
    (expires) => {
      const key = hkdfSync('sha256', SECRET, new Uint8Array(), 'liasse.api.file-url.v1', 32);
      const signature = createHmac('sha256', new Uint8Array(key))
        .update(`${DOCUMENT}\n${expires}`)
        .digest('base64url');
      expect(signer({ now: START }).verify({ documentId: DOCUMENT, expires, signature })).toBe(
        false,
      );
    },
  );

  it('refuses an id that is not a document id even with a signature made for it', () => {
    const expires = String((START + FILE_URL_TTL_MS) / 1000);
    const documentId = `${DOCUMENT}\n${expires}`;
    const key = hkdfSync('sha256', SECRET, new Uint8Array(), 'liasse.api.file-url.v1', 32);
    const signature = createHmac('sha256', new Uint8Array(key))
      .update(`${documentId}\n${expires}`)
      .digest('base64url');
    expect(signer({ now: START }).verify({ documentId, expires, signature })).toBe(false);
  });

  it('signs with a key of its own, not the secret nor the key of the identifier hashes', () => {
    const grant = grantOf(signer({ now: START }).sign(DOCUMENT));
    const message = `${DOCUMENT}\n${grant.expires}`;
    const withKey = (key: string | Uint8Array): string =>
      createHmac('sha256', key).update(message).digest('base64url');
    expect(grant.signature).not.toBe(withKey(SECRET));
    expect(grant.signature).not.toBe(withKey(deriveIdentifierKey(SECRET).hmacKey));
    expect(grant.signature).toBe(
      withKey(
        new Uint8Array(hkdfSync('sha256', SECRET, new Uint8Array(), 'liasse.api.file-url.v1', 32)),
      ),
    );
  });

  it('refuses to work without a secret', () => {
    expect(() => createFileUrls({ secret: '', publicUrl: 'https://liasse.example.com' })).toThrow(
      'Signed file URLs need a secret',
    );
  });
});
