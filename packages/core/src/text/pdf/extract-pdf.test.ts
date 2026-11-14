import { decode } from 'jpeg-js';
import { describe, expect, it } from 'vitest';
import { createFakeVisionModel } from '../../testing/fake-vision-model.ts';
import { buildSyntheticPdf } from '../../testing/synthetic-pdf.ts';
import { extractText } from '../extract-text.ts';
import { TRANSCRIPTION_PROMPT } from '../transcription-prompt.ts';

const PDF = 'application/pdf';

const LINE_LENGTH = 50;

// `count` visible characters, on lines short enough to stay inside the page.
const linesOf = (count: number): readonly string[] =>
  Array.from({ length: Math.ceil(count / LINE_LENGTH) }, (_, index) =>
    'x'.repeat(Math.min(LINE_LENGTH, count - index * LINE_LENGTH)),
  );

const widthOf = (jpeg: Uint8Array): number => decode(jpeg, { useTArray: true }).width;

const describeWidth = ({ image }: { readonly image: Uint8Array }): string =>
  `# Page ${String(widthOf(image))} pixels wide`;

describe('extractText on a PDF with a text layer', () => {
  it('keeps the native text at exactly 100 characters per page on average', async () => {
    const vision = createFakeVisionModel();
    const bytes = buildSyntheticPdf([{ lines: linesOf(150) }, { lines: linesOf(50) }]);
    expect(await extractText({ bytes, mime: PDF }, { vision })).toEqual({
      pages: [
        { page: 1, text: linesOf(150).join('\n') },
        { page: 2, text: linesOf(50).join('\n') },
      ],
      method: 'native',
      attachments: [],
    });
    expect(vision.calls).toHaveLength(0);
  });

  it('transcribes every page when the average falls just below 100 characters', async () => {
    const vision = createFakeVisionModel(() => 'transcribed');
    const bytes = buildSyntheticPdf([{ lines: linesOf(150) }, { lines: linesOf(49) }]);
    const result = await extractText({ bytes, mime: PDF }, { vision });
    expect(result.method).toBe('vision');
    expect(result.pages).toEqual([
      { page: 1, text: 'transcribed' },
      { page: 2, text: 'transcribed' },
    ]);
    expect(vision.calls).toHaveLength(2);
  });

  it('does not count whitespace towards the threshold', async () => {
    const vision = createFakeVisionModel(() => 'transcribed');
    const spaced = linesOf(99).map((line) => Array.from(line).join(' '));
    const bytes = buildSyntheticPdf([{ lines: spaced }]);
    expect((await extractText({ bytes, mime: PDF }, { vision })).method).toBe('vision');
  });

  it('keeps the lines of a page in reading order', async () => {
    const vision = createFakeVisionModel();
    const bytes = buildSyntheticPdf([
      {
        lines: [
          'Invoice 2026-001',
          'Jane Doe, 12 Example Street',
          'Total   84.20 EUR',
          ...linesOf(100),
        ],
      },
    ]);
    const result = await extractText({ bytes, mime: PDF }, { vision });
    expect(result.pages[0]?.text).toBe(
      ['Invoice 2026-001', 'Jane Doe, 12 Example Street', 'Total 84.20 EUR', ...linesOf(100)].join(
        '\n',
      ),
    );
  });

  it('accepts a long native PDF whatever the limit on scanned pages', async () => {
    const vision = createFakeVisionModel();
    const bytes = buildSyntheticPdf(Array.from({ length: 3 }, () => ({ lines: linesOf(120) })));
    const result = await extractText(
      { bytes, mime: PDF },
      { vision, limits: { maxVisionPages: 1 } },
    );
    expect(result.method).toBe('native');
    expect(result.pages).toHaveLength(3);
  });

  it('removes the NUL characters a broken font map puts in the text layer', async () => {
    const vision = createFakeVisionModel();
    const bytes = buildSyntheticPdf([{ lines: ['Jane@Doe', ...linesOf(100)] }], {
      toUnicode: { '@': '\u0000' },
    });
    const result = await extractText({ bytes, mime: PDF }, { vision });
    expect(result.pages[0]?.text).toBe(['JaneDoe', ...linesOf(100)].join('\n'));
  });

  it('stops reading the text layer once the signal aborts', async () => {
    const vision = createFakeVisionModel();
    const controller = new AbortController();
    const bytes = buildSyntheticPdf([{ lines: linesOf(120) }]);
    const extraction = extractText({ bytes, mime: PDF }, { vision, signal: controller.signal });
    // The signal is live when extraction starts and aborts while the PDF is being opened.
    controller.abort();
    await expect(extraction).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('extractText on a scanned PDF', () => {
  // Page widths of 72, 144 and 216 points come out 200, 400 and 600 pixels wide at 200 dpi,
  // which tells the rendered pages apart.
  const scan = buildSyntheticPdf(
    [72, 144, 216].map((widthPt) => ({ scanned: true, widthPt, heightPt: 72 })),
  );

  it('makes one vision call per page, rendered at 200 dpi as JPEG, with the prompt', async () => {
    const vision = createFakeVisionModel(describeWidth);
    const result = await extractText({ bytes: scan, mime: PDF }, { vision });
    expect(result).toEqual({
      pages: [
        { page: 1, text: '# Page 200 pixels wide' },
        { page: 2, text: '# Page 400 pixels wide' },
        { page: 3, text: '# Page 600 pixels wide' },
      ],
      method: 'vision',
      visionModel: 'fake-vision-model',
      attachments: [],
    });
    expect(vision.calls).toHaveLength(3);
    expect(vision.calls.map(({ mime, prompt }) => ({ mime, prompt }))).toEqual(
      Array.from({ length: 3 }, () => ({ mime: 'image/jpeg', prompt: TRANSCRIPTION_PROMPT })),
    );
  });

  it('returns the pages in order when later pages finish first', async () => {
    let releaseFirstPage = (): void => undefined;
    const lastPageStarted = new Promise<void>((resolve) => {
      releaseFirstPage = resolve;
    });
    const finished: number[] = [];
    const vision = createFakeVisionModel(async ({ image }) => {
      const width = widthOf(image);
      if (width === 600) releaseFirstPage();
      if (width === 200) await lastPageStarted;
      finished.push(width);
      return `width ${String(width)}`;
    });
    const result = await extractText(
      { bytes: scan, mime: PDF },
      { vision, limits: { visionConcurrency: 2 } },
    );
    expect(finished).toEqual([400, 600, 200]);
    expect(result.pages.map(({ text }) => text)).toEqual(['width 200', 'width 400', 'width 600']);
  });

  it('runs one vision call at a time when the concurrency is one', async () => {
    let inFlight = 0;
    let peak = 0;
    const vision = createFakeVisionModel(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      // Long enough for the next page to be rendered, were it allowed to start.
      await new Promise((resolve) => setTimeout(resolve, 150));
      inFlight -= 1;
      return '';
    });
    await extractText({ bytes: scan, mime: PDF }, { vision, limits: { visionConcurrency: 1 } });
    expect(peak).toBe(1);
  });

  it('treats an empty transcription as an empty page', async () => {
    const vision = createFakeVisionModel(() => ' \n');
    const bytes = buildSyntheticPdf([{ scanned: true }]);
    expect((await extractText({ bytes, mime: PDF }, { vision })).pages).toEqual([
      { page: 1, text: '' },
    ]);
  });

  it('normalises the transcription', async () => {
    const vision = createFakeVisionModel(() => 'Jane\u0000 Doe\r\n\r\n\r\n| a |   b |');
    const bytes = buildSyntheticPdf([{ scanned: true }]);
    expect((await extractText({ bytes, mime: PDF }, { vision })).pages[0]?.text).toBe(
      'Jane Doe\n\n| a | b |',
    );
  });

  it('lets a failed vision call propagate unchanged', async () => {
    const failure = new Error('provider unavailable');
    const vision = createFakeVisionModel(() => Promise.reject(failure));
    await expect(extractText({ bytes: scan, mime: PDF }, { vision })).rejects.toBe(failure);
  });

  it('refuses more scanned pages than the limit before any vision call', async () => {
    const vision = createFakeVisionModel(() => '');
    await expect(
      extractText({ bytes: scan, mime: PDF }, { vision, limits: { maxVisionPages: 2 } }),
    ).rejects.toMatchObject({ name: 'TextExtractionError', code: 'pdf_too_many_scanned_pages' });
    expect(vision.calls).toHaveLength(0);
  });

  it('accepts exactly as many scanned pages as the limit', async () => {
    const vision = createFakeVisionModel(() => '');
    const result = await extractText(
      { bytes: scan, mime: PDF },
      { vision, limits: { maxVisionPages: 3 } },
    );
    expect(result.pages).toHaveLength(3);
  });
});
