// The smallest byte sequences ingestion recognises as each format: the signature or the
// container of a real file and a label, which makes the hash differ from one test to
// the next. Nothing here can be decoded. For documents a reader opens, use
// `buildSyntheticPdf`, `buildSyntheticDocx`, `buildSyntheticPng` and `buildSyntheticZip`.

const ascii = (text: string): Buffer => Buffer.from(text, 'latin1');

export const syntheticPdf = (label = 'synthetic'): Uint8Array =>
  ascii(`%PDF-1.7\n% ${label}\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n`);

export const syntheticJpeg = (label = 'synthetic'): Uint8Array =>
  Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), ascii(`JFIF ${label}`)]);

export const syntheticPng = (label = 'synthetic'): Uint8Array =>
  Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ascii(label)]);

/** An ISO base media file whose `ftyp` box declares the given brands. */
export const syntheticIsoMedia = (
  majorBrand: string,
  compatibleBrands: readonly string[],
  label = 'synthetic',
): Uint8Array => {
  const brands = ascii([majorBrand, '\0\0\0\0', ...compatibleBrands].join(''));
  const size = Buffer.alloc(4);
  size.writeUInt32BE(8 + brands.length);
  return Buffer.concat([size, ascii('ftyp'), brands, ascii(label)]);
};

export const syntheticHeic = (label = 'synthetic'): Uint8Array =>
  syntheticIsoMedia('heic', ['mif1', 'heic'], label);

export const syntheticEml = (label = 'synthetic'): Uint8Array =>
  ascii(
    [
      'Return-Path: <sender@example.com>',
      'Received: from mail.example.com by mx.example.org;',
      '\tMon, 02 Nov 2026 10:00:00 +0000',
      'From: Sender <sender@example.com>',
      'To: recipient@example.org',
      `Subject: ${label}`,
      'Date: Mon, 02 Nov 2026 10:00:00 +0000',
      'Message-ID: <synthetic@example.com>',
      '',
      `Body of ${label}.`,
      '',
    ].join('\r\n'),
  );
