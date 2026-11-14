import { decode, encode } from 'jpeg-js';
import { describe, expect, it } from 'vitest';
import { extractText } from '../text/extract-text.ts';
import { createFakeVisionModel } from './fake-vision-model.ts';
import { buildSyntheticDocx } from './synthetic-docx.ts';
import { buildSyntheticPdf } from './synthetic-pdf.ts';
import { encodeWinAnsi, WinAnsiError } from './win-ansi.ts';

const PDF = 'application/pdf';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const FILLER = 'x'.repeat(60);

// A picture twice as wide as it is high, so that the rendered page tells it from the
// square bitmap of `scanned`.
const JPEG_WIDTH = 64;
const JPEG_HEIGHT = 32;
const jpeg = Uint8Array.from(
  encode(
    {
      width: JPEG_WIDTH,
      height: JPEG_HEIGHT,
      data: Uint8Array.from({ length: JPEG_WIDTH * JPEG_HEIGHT * 4 }, (_, index) =>
        index % 4 === 3 ? 255 : (index >> 2) % JPEG_WIDTH < JPEG_WIDTH / 2 ? 0 : 255,
      ),
    },
    90,
  ).data,
);

describe('encodeWinAnsi', () => {
  it('keeps Latin-1 characters as their code', () => {
    expect(Array.from(encodeWinAnsi('Aéÿ'))).toEqual([0x41, 0xe9, 0xff]);
  });

  it('maps the characters WinAnsi has in place of the Latin-1 control codes', () => {
    expect(Array.from(encodeWinAnsi('€’œ'))).toEqual([0x80, 0x92, 0x9c]);
  });

  it('refuses a character the encoding does not have', () => {
    expect(() => encodeWinAnsi('中')).toThrow(WinAnsiError);
  });
});

describe('buildSyntheticPdf', () => {
  it('writes text that reads back with its accents and its euro sign', async () => {
    const lines = ['Total à payer : 84,20 €', 'Société « Example »', FILLER, FILLER];
    const vision = createFakeVisionModel();
    const result = await extractText(
      { bytes: buildSyntheticPdf([{ lines }]), mime: PDF },
      { vision },
    );
    expect(result.pages[0]?.text).toBe(lines.join('\n'));
    expect(vision.calls).toHaveLength(0);
  });

  it('shows the JPEG of an image-only page to the vision model', async () => {
    const vision = createFakeVisionModel(({ image }) => {
      const { width, height, data } = decode(image, { useTArray: true });
      const left = data[(height >> 1) * width * 4] ?? 255;
      const right = data[((height >> 1) * width + width - 1) * 4] ?? 0;
      return `left ${left < 64 ? 'dark' : 'light'}, right ${right > 192 ? 'light' : 'dark'}`;
    });
    const bytes = buildSyntheticPdf([
      {
        jpeg: { bytes: jpeg, widthPx: JPEG_WIDTH, heightPx: JPEG_HEIGHT },
        widthPt: 200,
        heightPt: 100,
      },
    ]);
    expect((await extractText({ bytes, mime: PDF }, { vision })).pages).toEqual([
      { page: 1, text: 'left dark, right light', method: 'vision' },
    ]);
  });

  it('mixes text pages and image-only pages in one document', async () => {
    const vision = createFakeVisionModel(() => 'transcribed');
    const bytes = buildSyntheticPdf([
      { lines: [FILLER, FILLER, FILLER, FILLER, FILLER, FILLER] },
      { jpeg: { bytes: jpeg, widthPx: JPEG_WIDTH, heightPx: JPEG_HEIGHT } },
    ]);
    const result = await extractText({ bytes, mime: PDF }, { vision });
    expect(result.pages.map(({ method }) => method)).toEqual(['native', 'vision']);
    expect(result.method).toBe('mixed');
  });
});

describe('buildSyntheticDocx', () => {
  const body = '<w:p><w:r><w:t>Lease between Jane Doe and Example Corp</w:t></w:r></w:p>';

  it('reads the same whether its parts are stored or deflated', async () => {
    const vision = createFakeVisionModel();
    const texts = await Promise.all(
      [buildSyntheticDocx(body), buildSyntheticDocx(body, { stored: true })].map(
        async (bytes) => (await extractText({ bytes, mime: DOCX }, { vision })).pages[0]?.text,
      ),
    );
    expect(texts).toEqual([
      'Lease between Jane Doe and Example Corp',
      'Lease between Jane Doe and Example Corp',
    ]);
  });

  it('leaves the parts of a stored package readable in its bytes', () => {
    const stored = Buffer.from(buildSyntheticDocx(body, { stored: true })).toString('latin1');
    const deflated = Buffer.from(buildSyntheticDocx(body)).toString('latin1');
    expect(stored).toContain(body);
    expect(deflated).not.toContain(body);
  });
});
