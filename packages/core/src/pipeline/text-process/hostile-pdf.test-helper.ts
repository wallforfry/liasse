import { createDeflate } from 'node:zlib';

const MEBIBYTE = 1024 * 1024;

// One text operator per line, padded to 64 bytes so that a mebibyte holds a whole number
// of them: the stream stays valid wherever the repetition stops.
const OPERATOR = '(synthetic filler text) Tj T*'.padEnd(63, ' ') + '\n';
const BLOCK = Buffer.from(OPERATOR.repeat(MEBIBYTE / OPERATOR.length), 'latin1');

const latin1 = (text: string): Buffer => Buffer.from(text, 'latin1');

// The repeated block is deflated as it is written, so the builder never holds the
// inflated stream: only the reader of the PDF pays for it.
const deflateRepeated = async (prefix: Buffer, repetitions: number, suffix: Buffer) => {
  const deflate = createDeflate({ level: 9 });
  const compressed: Buffer[] = [];
  deflate.on('data', (chunk: Buffer) => compressed.push(chunk));
  const finished = new Promise<void>((resolve, reject) => {
    deflate.once('end', resolve);
    deflate.once('error', reject);
  });
  const write = (chunk: Buffer): Promise<void> =>
    new Promise((resolve) => {
      if (deflate.write(chunk)) resolve();
      else deflate.once('drain', resolve);
    });
  await write(prefix);
  for (let written = 0; written < repetitions; written += 1) await write(BLOCK);
  await write(suffix);
  deflate.end();
  await finished;
  return Buffer.concat(compressed);
};

const serialize = (objects: readonly Buffer[]): Uint8Array => {
  const header = latin1('%PDF-1.4\n');
  const offsets = objects.reduce<readonly number[]>(
    (known, _, index) => [
      ...known,
      index === 0 ? header.length : (known[index - 1] ?? 0) + (objects[index - 1]?.length ?? 0),
    ],
    [],
  );
  const xrefOffset = header.length + objects.reduce((total, object) => total + object.length, 0);
  const trailer = [
    'xref',
    `0 ${String(objects.length + 1)}`,
    '0000000000 65535 f ',
    ...offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n `),
    'trailer',
    `<< /Size ${String(objects.length + 1)} /Root 1 0 R >>`,
    'startxref',
    String(xrefOffset),
    '%%EOF',
    '',
  ].join('\n');
  return Uint8Array.from(Buffer.concat([header, ...objects, latin1(trailer)]));
};

// A one-page PDF of a few hundred kilobytes whose content stream inflates to
// `inflatedMebibytes` of text operators: what a reader allocates has no relation to the
// size of the file.
export const buildHostilePdf = async (inflatedMebibytes: number): Promise<Uint8Array> => {
  const stream = await deflateRepeated(
    latin1('BT\n/F1 12 Tf\n14 TL\n50 780 Td\n'),
    inflatedMebibytes,
    latin1('ET\n'),
  );
  return serialize([
    latin1('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n'),
    latin1('2 0 obj\n<< /Type /Pages /Kids [4 0 R] /Count 1 >>\nendobj\n'),
    latin1(
      '3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n',
    ),
    latin1(
      '4 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 5 0 R /Resources << /Font << /F1 3 0 R >> >> >>\nendobj\n',
    ),
    Buffer.concat([
      latin1(`5 0 obj\n<< /Filter /FlateDecode /Length ${String(stream.length)} >>\nstream\n`),
      stream,
      latin1('\nendstream\nendobj\n'),
    ]),
  ]);
};
