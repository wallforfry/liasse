import { crc32 } from 'node:zlib';

// The smallest byte sequences ingestion recognises as each format. They carry the
// signatures and containers of real files, not renderable content.

const ascii = (text: string): Buffer => Buffer.from(text, 'latin1');

const uint16 = (value: number): Buffer => {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
};

const uint32 = (value: number): Buffer => {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value);
  return buffer;
};

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

/** A ZIP archive of stored (uncompressed) entries, with a valid central directory. */
export const syntheticZip = (entries: Readonly<Record<string, string>>): Uint8Array => {
  const files = Object.entries(entries).map(([name, content]) => ({
    name: Buffer.from(name, 'utf8'),
    data: Buffer.from(content, 'utf8'),
  }));
  const described = files.map(({ name, data }) =>
    Buffer.concat([
      uint16(0),
      uint16(0),
      uint16(0),
      uint16(0),
      uint32(crc32(data)),
      uint32(data.length),
      uint32(data.length),
      uint16(name.length),
      uint16(0),
    ]),
  );
  const locals = files.map(({ name, data }, index) =>
    Buffer.concat([
      uint32(0x04034b50),
      uint16(20),
      described[index] ?? Buffer.alloc(0),
      name,
      data,
    ]),
  );
  const offsets = locals.map((_, index) =>
    locals.slice(0, index).reduce((total, local) => total + local.length, 0),
  );
  const central = files.map(({ name }, index) =>
    Buffer.concat([
      uint32(0x02014b50),
      uint16(20),
      uint16(20),
      described[index] ?? Buffer.alloc(0),
      uint16(0),
      uint16(0),
      uint16(0),
      uint32(0),
      uint32(offsets[index] ?? 0),
      name,
    ]),
  );
  const centralStart = locals.reduce((total, local) => total + local.length, 0);
  const centralSize = central.reduce((total, header) => total + header.length, 0);
  const end = Buffer.concat([
    uint32(0x06054b50),
    uint16(0),
    uint16(0),
    uint16(files.length),
    uint16(files.length),
    uint32(centralSize),
    uint32(centralStart),
    uint16(0),
  ]);
  return Buffer.concat([...locals, ...central, end]);
};

export const syntheticDocx = (label = 'synthetic'): Uint8Array =>
  syntheticZip({
    '[Content_Types].xml': '<Types/>',
    'word/document.xml': `<w:document><w:t>${label}</w:t></w:document>`,
  });

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
