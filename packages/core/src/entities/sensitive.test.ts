import { createHmac, hkdfSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { deriveIdentifierKey, maskSensitiveIdentifier } from './sensitive.ts';
import { SYNTHETIC_CARD, SYNTHETIC_IBAN, TEST_IDENTIFIER_KEY } from './support.test-helper.ts';

describe('deriveIdentifierKey', () => {
  it('derives 32 bytes from the secret with HKDF-SHA-256 under its own label', () => {
    const secret = 'synthetic-file-url-secret-0123456789';
    expect(deriveIdentifierKey(secret).hmacKey).toEqual(
      new Uint8Array(
        hkdfSync('sha256', secret, new Uint8Array(), 'liasse.entities.identifier-hash.v1', 32),
      ),
    );
  });

  it('is not the secret itself', () => {
    const secret = 'synthetic-file-url-secret-0123456789';
    expect(Buffer.from(deriveIdentifierKey(secret).hmacKey).toString()).not.toBe(secret);
  });

  it('refuses an empty secret', () => {
    expect(() => deriveIdentifierKey('')).toThrow(/secret/);
  });
});

describe('maskSensitiveIdentifier', () => {
  it('keeps the last four characters and a keyed hash of an IBAN', () => {
    const masked = maskSensitiveIdentifier(TEST_IDENTIFIER_KEY, 'iban', SYNTHETIC_IBAN);
    expect(masked).toEqual({
      masked: '****0146',
      last4: '0146',
      hash: createHmac('sha256', TEST_IDENTIFIER_KEY.hmacKey)
        .update(`iban\n${SYNTHETIC_IBAN}`)
        .digest('hex'),
    });
    expect(JSON.stringify(masked)).not.toContain('SYNTHETIC');
  });

  it('keeps the last four digits and a keyed hash of a card number', () => {
    expect(maskSensitiveIdentifier(TEST_IDENTIFIER_KEY, 'card_number', SYNTHETIC_CARD)).toEqual({
      masked: '****4242',
      last4: '4242',
      hash: createHmac('sha256', TEST_IDENTIFIER_KEY.hmacKey)
        .update(`card_number\n${SYNTHETIC_CARD}`)
        .digest('hex'),
    });
  });

  it('gives the same result however the value is written', () => {
    const reference = maskSensitiveIdentifier(TEST_IDENTIFIER_KEY, 'iban', SYNTHETIC_IBAN);
    expect(
      maskSensitiveIdentifier(TEST_IDENTIFIER_KEY, 'iban', ' fr75 9999-9000 01sy.nthe tic0 146 '),
    ).toEqual(reference);
    expect(
      maskSensitiveIdentifier(TEST_IDENTIFIER_KEY, 'card_number', '4242-4242 4242.4242'),
    ).toEqual(maskSensitiveIdentifier(TEST_IDENTIFIER_KEY, 'card_number', SYNTHETIC_CARD));
  });

  it('gives another hash under another secret, for another value and for another type', () => {
    const { hash } = maskSensitiveIdentifier(TEST_IDENTIFIER_KEY, 'card_number', SYNTHETIC_CARD);
    const otherKey = deriveIdentifierKey('another-synthetic-secret-0123456789');
    expect(maskSensitiveIdentifier(otherKey, 'card_number', SYNTHETIC_CARD).hash).not.toBe(hash);
    expect(
      maskSensitiveIdentifier(TEST_IDENTIFIER_KEY, 'card_number', '5555555555554444').hash,
    ).not.toBe(hash);
    expect(maskSensitiveIdentifier(TEST_IDENTIFIER_KEY, 'iban', SYNTHETIC_CARD).hash).not.toBe(
      hash,
    );
  });

  it('shows nothing of a value of four characters or fewer', () => {
    expect(maskSensitiveIdentifier(TEST_IDENTIFIER_KEY, 'card_number', '4242')).toMatchObject({
      masked: '****',
      last4: '',
    });
    expect(maskSensitiveIdentifier(TEST_IDENTIFIER_KEY, 'card_number', '42425')).toMatchObject({
      masked: '****2425',
      last4: '2425',
    });
  });
});
