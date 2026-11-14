import { createHash } from 'node:crypto';

// The standard security handler of PDF 1.4, revision 2 (ISO 32000-1, 7.6.3): RC4 with a
// 40-bit key. Obsolete as a protection, but every reader still enforces its password.
const PASSWORD_PADDING = Uint8Array.from([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);
const KEY_BYTES = 5;
const OWNER_PASSWORD = 'synthetic-owner';
// Printing allowed, everything else denied; the value only has to be consistent.
const PERMISSIONS = -64;
const FILE_ID = Buffer.from('liasse-synthetic-pdf-0001', 'latin1');

const md5 = (...parts: readonly Uint8Array[]): Uint8Array =>
  Uint8Array.from(createHash('md5').update(Buffer.concat(parts)).digest());

const padPassword = (password: string): Uint8Array =>
  Uint8Array.from(
    Buffer.concat([Buffer.from(password, 'latin1'), PASSWORD_PADDING]).subarray(0, 32),
  );

// OpenSSL 3 only ships RC4 in its legacy provider, which Node does not load.
const rc4 = (key: Uint8Array, data: Uint8Array): Uint8Array => {
  const state = Uint8Array.from({ length: 256 }, (_, index) => index);
  let j = 0;
  for (let i = 0; i < 256; i += 1) {
    j = (j + (state[i] ?? 0) + (key[i % key.length] ?? 0)) % 256;
    const swap = state[i] ?? 0;
    state[i] = state[j] ?? 0;
    state[j] = swap;
  }
  let a = 0;
  let b = 0;
  return data.map((byte) => {
    a = (a + 1) % 256;
    b = (b + (state[a] ?? 0)) % 256;
    const swap = state[a] ?? 0;
    state[a] = state[b] ?? 0;
    state[b] = swap;
    return byte ^ (state[((state[a] ?? 0) + (state[b] ?? 0)) % 256] ?? 0);
  });
};

const littleEndian = (value: number, bytes: number): Uint8Array =>
  Uint8Array.from({ length: bytes }, (_, index) => (value >> (8 * index)) & 0xff);

const ownerEntry = (userPassword: string): Uint8Array =>
  rc4(md5(padPassword(OWNER_PASSWORD)).subarray(0, KEY_BYTES), padPassword(userPassword));

const fileKey = (userPassword: string): Uint8Array =>
  md5(
    padPassword(userPassword),
    ownerEntry(userPassword),
    littleEndian(PERMISSIONS, 4),
    FILE_ID,
  ).subarray(0, KEY_BYTES);

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

export const encryptPdfStream = (
  stream: Uint8Array,
  objectId: number,
  userPassword: string,
): Uint8Array => {
  const objectKey = md5(fileKey(userPassword), littleEndian(objectId, 3), littleEndian(0, 2));
  return rc4(objectKey.subarray(0, KEY_BYTES + 5), stream);
};

export const pdfEncryptionDictionary = (userPassword: string): string => {
  const userEntry = rc4(fileKey(userPassword), PASSWORD_PADDING);
  return [
    `/Encrypt << /Filter /Standard /V 1 /R 2 /P ${String(PERMISSIONS)}`,
    `/O <${hex(ownerEntry(userPassword))}> /U <${hex(userEntry)}> >>`,
    `/ID [<${hex(FILE_ID)}> <${hex(FILE_ID)}>]`,
  ].join(' ');
};
