import { encryptPdfStream, pdfEncryptionDictionary } from './synthetic-pdf-encryption.ts';

const DEFAULT_PAGE_WIDTH_PT = 595;
const DEFAULT_PAGE_HEIGHT_PT = 842;
const SCAN_PIXELS = 8;

export interface SyntheticPdfPage {
  // Set in 12-point Helvetica from the top left. pdfjs drops the glyphs that fall outside
  // the page, so keep a line under about 80 characters and a page under 50 lines.
  readonly lines?: readonly string[];
  // An image-only page, as a scanner produces: a grey bitmap stretched over the whole page.
  readonly scanned?: boolean;
  readonly widthPt?: number;
  readonly heightPt?: number;
  // The visible part of the page, from its bottom left corner, when smaller than the page.
  readonly cropBoxPt?: readonly [width: number, height: number];
  // The size of one unit of the page in points (PDF 1.6 `UserUnit`), 1 when absent.
  readonly userUnit?: number;
}

export interface SyntheticPdfOptions {
  // Encrypts the document (RC4, 40 bits) so that it cannot be opened without this password.
  readonly userPassword?: string;
  // What a reader gets when it copies a character: each key is one character of `lines`,
  // each value the text it stands for, as the ToUnicode map of an embedded font declares.
  readonly toUnicode?: Readonly<Record<string, string>>;
}

interface PdfObject {
  readonly dictionary: string;
  readonly stream?: Uint8Array;
}

const CATALOG_ID = 1;
const PAGES_ID = 2;
const FONT_ID = 3;
const FIRST_PAGE_ID = 4;
const OBJECTS_PER_PAGE = 3;

const latin1 = (text: string): Uint8Array => Uint8Array.from(Buffer.from(text, 'latin1'));

const escapePdfString = (text: string): string => text.replace(/[\\()]/g, (char) => `\\${char}`);

const textContent = (lines: readonly string[], heightPt: number): string =>
  [
    'BT',
    '/F1 12 Tf',
    '14 TL',
    `50 ${String(heightPt - 60)} Td`,
    ...lines.map((line) => `(${escapePdfString(line)}) Tj T*`),
    'ET',
  ].join('\n');

const hex = (value: number, digits: number): string =>
  value.toString(16).padStart(digits, '0').toUpperCase();

const utf16Hex = (text: string): string =>
  Array.from({ length: text.length }, (_, index) => hex(text.charCodeAt(index), 4)).join('');

const toUnicodeMap = (mapping: Readonly<Record<string, string>>): string =>
  [
    '/CIDInit /ProcSet findresource begin',
    '12 dict begin',
    'begincmap',
    '/CMapName /LiasseSynthetic def',
    '/CMapType 2 def',
    '1 begincodespacerange',
    '<00> <FF>',
    'endcodespacerange',
    `${String(Object.keys(mapping).length)} beginbfchar`,
    ...Object.entries(mapping).map(
      ([character, text]) => `<${hex(character.charCodeAt(0), 2)}> <${utf16Hex(text)}>`,
    ),
    'endbfchar',
    'endcmap',
    'CMapName currentdict /CMap defineresource pop',
    'end',
    'end',
  ].join('\n');

const scanContent = (widthPt: number, heightPt: number): string =>
  `q ${String(widthPt)} 0 0 ${String(heightPt)} 0 0 cm /Im0 Do Q`;

const scanBitmap = (): Uint8Array =>
  Uint8Array.from({ length: SCAN_PIXELS * SCAN_PIXELS }, (_, index) => (index * 4) % 256);

const pageObjects = (page: SyntheticPdfPage, index: number): readonly PdfObject[] => {
  const pageId = FIRST_PAGE_ID + index * OBJECTS_PER_PAGE;
  const widthPt = page.widthPt ?? DEFAULT_PAGE_WIDTH_PT;
  const heightPt = page.heightPt ?? DEFAULT_PAGE_HEIGHT_PT;
  const scanned = page.scanned === true;
  const content = scanned
    ? scanContent(widthPt, heightPt)
    : textContent(page.lines ?? [], heightPt);
  return [
    {
      dictionary: [
        `/Type /Page /Parent ${String(PAGES_ID)} 0 R`,
        `/MediaBox [0 0 ${String(widthPt)} ${String(heightPt)}]`,
        ...(page.cropBoxPt === undefined
          ? []
          : [`/CropBox [0 0 ${String(page.cropBoxPt[0])} ${String(page.cropBoxPt[1])}]`]),
        ...(page.userUnit === undefined ? [] : [`/UserUnit ${String(page.userUnit)}`]),
        `/Contents ${String(pageId + 1)} 0 R`,
        `/Resources << /Font << /F1 ${String(FONT_ID)} 0 R >> /XObject << /Im0 ${String(pageId + 2)} 0 R >> >>`,
      ].join(' '),
    },
    { dictionary: '', stream: latin1(content) },
    {
      dictionary: `/Type /XObject /Subtype /Image /Width ${String(SCAN_PIXELS)} /Height ${String(SCAN_PIXELS)} /ColorSpace /DeviceGray /BitsPerComponent 8`,
      stream: scanBitmap(),
    },
  ];
};

const serializeObject = (
  object: PdfObject,
  id: number,
  options: SyntheticPdfOptions,
): Uint8Array => {
  if (object.stream === undefined) {
    return latin1(`${String(id)} 0 obj\n<< ${object.dictionary} >>\nendobj\n`);
  }
  const stream =
    options.userPassword === undefined
      ? object.stream
      : encryptPdfStream(object.stream, id, options.userPassword);
  return Buffer.concat([
    latin1(
      `${String(id)} 0 obj\n<< ${object.dictionary} /Length ${String(stream.length)} >>\nstream\n`,
    ),
    stream,
    latin1('\nendstream\nendobj\n'),
  ]);
};

const offsetsOf = (header: Uint8Array, bodies: readonly Uint8Array[]): readonly number[] =>
  bodies.reduce<readonly number[]>(
    (offsets, _, index) => [
      ...offsets,
      index === 0 ? header.length : (offsets[index - 1] ?? 0) + (bodies[index - 1]?.length ?? 0),
    ],
    [],
  );

// Writes a small, valid PDF by hand, so that tests exercise real parsers and the real
// `pdftoppm` without a document taken from anyone.
export const buildSyntheticPdf = (
  pages: readonly SyntheticPdfPage[],
  options: SyntheticPdfOptions = {},
): Uint8Array => {
  const kids = pages
    .map((_, index) => `${String(FIRST_PAGE_ID + index * OBJECTS_PER_PAGE)} 0 R`)
    .join(' ');
  const toUnicodeId = FIRST_PAGE_ID + pages.length * OBJECTS_PER_PAGE;
  const font = '/Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding';
  const objects: readonly PdfObject[] = [
    { dictionary: `/Type /Catalog /Pages ${String(PAGES_ID)} 0 R` },
    { dictionary: `/Type /Pages /Kids [${kids}] /Count ${String(pages.length)}` },
    options.toUnicode === undefined
      ? { dictionary: font }
      : { dictionary: `${font} /ToUnicode ${String(toUnicodeId)} 0 R` },
    ...pages.flatMap(pageObjects),
    ...(options.toUnicode === undefined
      ? []
      : [{ dictionary: '', stream: latin1(toUnicodeMap(options.toUnicode)) }]),
  ];
  const header = latin1('%PDF-1.4\n');
  const bodies = objects.map((object, index) => serializeObject(object, index + 1, options));
  const offsets = offsetsOf(header, bodies);
  const xrefOffset = header.length + bodies.reduce((total, body) => total + body.length, 0);
  const encryption =
    options.userPassword === undefined ? '' : ` ${pdfEncryptionDictionary(options.userPassword)}`;
  const trailer = [
    'xref',
    `0 ${String(objects.length + 1)}`,
    '0000000000 65535 f ',
    ...offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n `),
    'trailer',
    `<< /Size ${String(objects.length + 1)} /Root ${String(CATALOG_ID)} 0 R${encryption} >>`,
    'startxref',
    String(xrefOffset),
    '%%EOF',
    '',
  ].join('\n');
  return Uint8Array.from(Buffer.concat([header, ...bodies, latin1(trailer)]));
};
