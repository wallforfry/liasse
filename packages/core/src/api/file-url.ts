import { createHash, createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';

// Fifteen minutes, by the specification.
export const FILE_URL_TTL_MS = 15 * 60 * 1000;

// The label keeps this key apart from every other key derived from the same secret,
// such as the one of the entity identifier hashes.
const KEY_LABEL = 'liasse.api.file-url.v1';
const KEY_LENGTH = 32;
const DOCUMENT_ID = /^doc_[0-9A-HJKMNP-TV-Z]{26}$/;
const EXPIRY = /^[1-9]\d{0,14}$/;

export interface FileUrlOptions {
  /** `config.auth.fileUrlSecret`. */
  readonly secret: string;
  /** `config.server.publicUrl`: an origin, never taken from a request. */
  readonly publicUrl: string;
  readonly now?: () => number;
  readonly ttlMs?: number;
}

export interface FileUrlGrant {
  readonly documentId: string;
  /** Seconds since the epoch, as the `expires` parameter carries it. */
  readonly expires: string;
  readonly signature: string;
}

export interface FileUrls {
  /** The URL of the original file of a document, usable without any other credential. */
  readonly sign: (documentId: string) => string;
  /**
   * True for a grant this signer issued for this document and that has not expired.
   * A grant may be used any number of times until then: a browser asks for a file more
   * than once (preview, ranges, download).
   */
  readonly verify: (grant: FileUrlGrant) => boolean;
}

const digest = (value: string | Uint8Array): Buffer => createHash('sha256').update(value).digest();

export const createFileUrls = ({
  secret,
  publicUrl,
  now = Date.now,
  ttlMs = FILE_URL_TTL_MS,
}: FileUrlOptions): FileUrls => {
  if (secret === '') throw new Error('Signed file URLs need a secret');
  const key = new Uint8Array(hkdfSync('sha256', secret, new Uint8Array(), KEY_LABEL, KEY_LENGTH));
  // The id cannot hold a line feed, so the two parts cannot be shifted into each other.
  const mac = (documentId: string, expires: string): string =>
    createHmac('sha256', key).update(`${documentId}\n${expires}`).digest('base64url');

  return {
    sign: (documentId) => {
      const expires = String(Math.floor((now() + ttlMs) / 1000));
      const query = new URLSearchParams({ expires, signature: mac(documentId, expires) });
      return `${publicUrl}/documents/${encodeURIComponent(documentId)}/file?${query.toString()}`;
    },
    verify: ({ documentId, expires, signature }) => {
      const wellFormed = DOCUMENT_ID.test(documentId) && EXPIRY.test(expires);
      // Both sides are hashed, so the comparison takes the same time whatever the length
      // of what was presented, and it runs even for a grant already known to be refused.
      const expected = digest(mac(wellFormed ? documentId : '', wellFormed ? expires : ''));
      const matches = timingSafeEqual(expected, digest(signature));
      return wellFormed && matches && Number(expires) * 1000 > now();
    },
  };
};
