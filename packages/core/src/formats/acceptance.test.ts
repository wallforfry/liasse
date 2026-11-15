import { readFile } from 'node:fs/promises';
import type { SupportedMime } from '@liasse/contract/domain';
import { describe, expect, it } from 'vitest';
import { detectMimeType } from '../ingest/mime.ts';
import { createFakeVisionModel } from '../testing/fake-vision-model.ts';
import { buildSyntheticDocx } from '../testing/synthetic-docx.ts';
import { syntheticEml, syntheticIsoMedia } from '../testing/synthetic-files.ts';
import { buildSyntheticPdf } from '../testing/synthetic-pdf.ts';
import { buildSyntheticPng } from '../testing/synthetic-png.ts';
import { TextExtractionError } from '../text/errors.ts';
import { extractText } from '../text/extract-text.ts';
import { withCentralField, withDirectoryCutAt } from './zip-damage.test-helper.ts';
import { ZipFormatError } from './zip.ts';

const PDF = 'application/pdf';
const JPEG = 'image/jpeg';
const PNG = 'image/png';
const HEIC = 'image/heic';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const EML = 'message/rfc822';
const MAIN = 'word/document.xml';
const OLD_EXTRACTION_SAMPLE_BYTES = 16 * 1024;

type Outcome = 'read' | 'refused for its format' | 'failed while decoding';

interface FormatCase {
  readonly bytes: Uint8Array;
  /** The type the file presents itself as: the one extraction is asked to read it as. */
  readonly claims: SupportedMime;
  readonly ingested: boolean;
  readonly extraction: Outcome;
}

const fixture = async (name: string): Promise<Uint8Array> =>
  Uint8Array.from(await readFile(new URL(`../text/fixtures/${name}`, import.meta.url)));

const eml = (lines: readonly string[]): Uint8Array => new TextEncoder().encode(lines.join('\r\n'));

const BOM = [0xef, 0xbb, 0xbf];
const MESSAGE = ['From: jane.doe@example.com', 'Subject: Synthetic', '', 'Body.'];
const paddingHeaders = Array.from(
  { length: Math.ceil(OLD_EXTRACTION_SAMPLE_BYTES / 40) + 1 },
  (_, index) => `X-Synthetic-${String(index).padStart(4, '0')}: ${'x'.repeat(20)}`,
);

const docx = buildSyntheticDocx('<w:p><w:r><w:t>Jane Doe</w:t></w:r></w:p>');
const withDamagedStream = (archive: Uint8Array): Uint8Array => {
  const start = Buffer.from(archive).indexOf(MAIN) + MAIN.length;
  const damaged = archive.slice();
  damaged.fill(0xff, start, start + 8);
  return damaged;
};

const heic = await fixture('gradient-64x48.heic');

const refusedByBoth = (bytes: Uint8Array, claims: SupportedMime): FormatCase => ({
  bytes,
  claims,
  ingested: false,
  extraction: 'refused for its format',
});
const readByBoth = (bytes: Uint8Array, claims: SupportedMime): FormatCase => ({
  bytes,
  claims,
  ingested: true,
  extraction: 'read',
});
// The format is right and the content is not: only decoding can tell, which ingestion
// does not do. These files are accepted and then fail extraction with a permanent error;
// they are outside the invariant below, which is about format recognition alone.
const acceptedThenUndecodable = (bytes: Uint8Array, claims: SupportedMime): FormatCase => ({
  bytes,
  claims,
  ingested: true,
  extraction: 'failed while decoding',
});

const CASES: readonly (readonly [string, FormatCase])[] = [
  ['a PDF', readByBoth(buildSyntheticPdf([{ lines: ['Synthetic invoice'] }]), PDF)],
  ['a JPEG', readByBoth(await fixture('gradient-64x48.jpg'), JPEG)],
  ['a PNG', readByBoth(buildSyntheticPng(8, 8), PNG)],

  ['an email', readByBoth(syntheticEml(), EML)],
  [
    'an email whose sender sits beyond 16 KiB of headers',
    readByBoth(eml([...paddingHeaders, ...MESSAGE]), EML),
  ],
  [
    'an email with only non-sender headers',
    refusedByBoth(
      eml(['Subject: Synthetic', 'Date: Tue, 03 Nov 2026 09:30:00 +0100', '', 'B']),
      EML,
    ),
  ],
  [
    'an email after a byte order mark',
    refusedByBoth(Uint8Array.from([...BOM, ...eml(MESSAGE)]), EML),
  ],
  ['an email after blank lines', refusedByBoth(eml(['', '', ...MESSAGE]), EML)],
  [
    'a text note shaped like headers',
    refusedByBoth(eml(['Note: call Jane Doe', 'Todo: tomorrow', '', 'Bring the file.']), EML),
  ],
  [
    'an email with a line that is no header in its header block',
    refusedByBoth(eml(['From: jane.doe@example.com', 'not a header', 'Subject: S', '', 'B']), EML),
  ],

  ['a DOCX', readByBoth(docx, DOCX)],
  [
    'a DOCX whose central directory is cut short',
    refusedByBoth(withDirectoryCutAt(docx, MAIN), DOCX),
  ],
  [
    'a DOCX whose main document points away from its local header',
    refusedByBoth(withCentralField(docx, MAIN, 'localOffset', 5), DOCX),
  ],
  [
    'a DOCX whose main document uses an unsupported compression method',
    refusedByBoth(withCentralField(docx, MAIN, 'method', 12), DOCX),
  ],
  [
    'a DOCX whose main document runs past the end of the archive',
    refusedByBoth(withCentralField(docx, MAIN, 'compressedSize', 0xffffff), DOCX),
  ],
  [
    // Extraction never opens the content types, so it reads what ingestion refuses:
    // ingestion may be the stricter of the two, never the looser.
    'a DOCX whose content types cannot be located',
    {
      bytes: withCentralField(docx, '[Content_Types].xml', 'method', 12),
      claims: DOCX,
      ingested: false,
      extraction: 'read',
    },
  ],
  [
    'a DOCX whose main document is a damaged deflate stream',
    acceptedThenUndecodable(withDamagedStream(docx), DOCX),
  ],

  ['a HEIC image', readByBoth(heic, HEIC)],
  [
    'ISO media with a brand that is not HEIC',
    refusedByBoth(syntheticIsoMedia('avif', ['mif1', 'miaf']), HEIC),
  ],
  [
    'ISO media of major brand mif1 with a HEIC compatible brand and no image',
    acceptedThenUndecodable(syntheticIsoMedia('mif1', ['mif1', 'heic']), HEIC),
  ],
  ['a HEIC image cut short', acceptedThenUndecodable(heic.slice(0, 600), HEIC)],
];

const FORMAT_REFUSALS = [
  /^The file is not an email/,
  /^The file is not a valid image\//,
  /^The archive holds no word\/document\.xml/,
];

const isFormatRefusal = (error: TextExtractionError): boolean =>
  error.cause instanceof ZipFormatError ||
  FORMAT_REFUSALS.some((pattern) => pattern.test(error.message));

const extractionOf = async (bytes: Uint8Array, mime: SupportedMime): Promise<Outcome> => {
  try {
    await extractText({ bytes, mime }, { vision: createFakeVisionModel(() => 'Synthetic') });
    return 'read';
  } catch (error) {
    if (!(error instanceof TextExtractionError)) throw error;
    return isFormatRefusal(error) ? 'refused for its format' : 'failed while decoding';
  }
};

describe('format recognition, by ingestion and by text extraction', () => {
  it.each(CASES)('agrees on %s', async (_label, { bytes, claims, ingested, extraction }) => {
    expect({
      ingested: detectMimeType(bytes),
      extraction: await extractionOf(bytes, claims),
    }).toEqual({ ingested: ingested ? claims : undefined, extraction });
  });

  // The invariant itself, read from the two behaviours rather than from the table: a
  // file ingestion accepts as a type is never refused by extraction for not being of
  // that type. A file that extraction always refuses would be a document failing forever.
  it.each(CASES)('never ingests %s as a type extraction refuses', async (_label, { bytes }) => {
    const mime = detectMimeType(bytes);
    const outcome = mime === undefined ? 'not ingested' : await extractionOf(bytes, mime);
    expect(outcome).not.toBe('refused for its format');
  });
});
