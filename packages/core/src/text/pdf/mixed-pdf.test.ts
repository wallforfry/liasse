import { describe, expect, it } from 'vitest';
import { createFakeVisionModel } from '../../testing/fake-vision-model.ts';
import { buildSyntheticPdf, type SyntheticPdfPage } from '../../testing/synthetic-pdf.ts';
import { extractText } from '../extract-text.ts';

const PDF = 'application/pdf';
const LINE_LENGTH = 50;

const linesOf = (count: number): readonly string[] =>
  Array.from({ length: Math.ceil(count / LINE_LENGTH) }, (_, index) =>
    'x'.repeat(Math.min(LINE_LENGTH, count - index * LINE_LENGTH)),
  );

const textPage = (characters: number): SyntheticPdfPage => ({ lines: linesOf(characters) });
const textOf = (characters: number): string => linesOf(characters).join('\n');
const scannedPage: SyntheticPdfPage = { scanned: true };

describe('extractText on a PDF that mixes native and scanned pages', () => {
  it('transcribes only the pages without text in a native document', async () => {
    const vision = createFakeVisionModel(() => 'transcribed scan');
    const bytes = buildSyntheticPdf([textPage(600), scannedPage, textPage(600), scannedPage]);
    expect(await extractText({ bytes, mime: PDF }, { vision })).toEqual({
      pages: [
        { page: 1, text: textOf(600), method: 'native' },
        { page: 2, text: 'transcribed scan', method: 'vision' },
        { page: 3, text: textOf(600), method: 'native' },
        { page: 4, text: 'transcribed scan', method: 'vision' },
      ],
      method: 'mixed',
      visionModel: 'fake-vision-model',
      attachments: [],
    });
    expect(vision.calls).toHaveLength(2);
  });

  it('keeps a page of exactly 20 characters native and transcribes one of 19', async () => {
    const vision = createFakeVisionModel(() => 'transcribed');
    const atThreshold = buildSyntheticPdf([textPage(400), textPage(20)]);
    expect(await extractText({ bytes: atThreshold, mime: PDF }, { vision })).toMatchObject({
      pages: [{ method: 'native' }, { text: textOf(20), method: 'native' }],
      method: 'native',
    });
    expect(vision.calls).toHaveLength(0);

    const below = buildSyntheticPdf([textPage(400), textPage(19)]);
    expect(await extractText({ bytes: below, mime: PDF }, { vision })).toMatchObject({
      pages: [{ method: 'native' }, { text: 'transcribed', method: 'vision' }],
      method: 'mixed',
    });
    expect(vision.calls).toHaveLength(1);
  });

  it('returns the text of a sparse document longer than the vision budget', async () => {
    const vision = createFakeVisionModel(() => 'transcribed');
    const bytes = buildSyntheticPdf(Array.from({ length: 5 }, () => textPage(20)));
    const result = await extractText(
      { bytes, mime: PDF },
      { vision, limits: { maxVisionPages: 4 } },
    );
    expect(result.method).toBe('native');
    expect(result.pages).toEqual(
      Array.from({ length: 5 }, (_, index) => ({
        page: index + 1,
        text: textOf(20),
        method: 'native',
      })),
    );
    expect(vision.calls).toHaveLength(0);
  });

  const sparseWithScans = buildSyntheticPdf([
    textPage(20),
    scannedPage,
    textPage(20),
    scannedPage,
    textPage(20),
  ]);

  it('transcribes the pages without text of a document longer than the budget', async () => {
    const vision = createFakeVisionModel(() => 'transcribed');
    const result = await extractText(
      { bytes: sparseWithScans, mime: PDF },
      { vision, limits: { maxVisionPages: 2 } },
    );
    expect(result.method).toBe('mixed');
    expect(result.pages.map(({ method }) => method)).toEqual([
      'native',
      'vision',
      'native',
      'vision',
      'native',
    ]);
    expect(vision.calls).toHaveLength(2);
  });

  it('fails only when the pages without text exceed the vision budget', async () => {
    const vision = createFakeVisionModel(() => 'transcribed');
    const failure = extractText(
      { bytes: sparseWithScans, mime: PDF },
      { vision, limits: { maxVisionPages: 1 } },
    );
    await expect(failure).rejects.toMatchObject({
      name: 'TextExtractionError',
      code: 'pdf_too_many_scanned_pages',
      retryable: false,
    });
    await expect(failure).rejects.toThrow(/2 of the 5 pages/);
    expect(vision.calls).toHaveLength(0);
  });

  it('refuses a native document whose pages without text exceed the vision budget', async () => {
    const vision = createFakeVisionModel(() => 'transcribed');
    const bytes = buildSyntheticPdf([textPage(600), scannedPage, scannedPage]);
    await expect(
      extractText({ bytes, mime: PDF }, { vision, limits: { maxVisionPages: 1 } }),
    ).rejects.toMatchObject({ code: 'pdf_too_many_scanned_pages' });
    expect(vision.calls).toHaveLength(0);
  });

  it('transcribes every page of a scanned document that fits the budget', async () => {
    const vision = createFakeVisionModel(() => 'transcribed');
    const bytes = buildSyntheticPdf([textPage(30), scannedPage]);
    const result = await extractText({ bytes, mime: PDF }, { vision });
    expect(result).toMatchObject({
      pages: [{ method: 'vision' }, { method: 'vision' }],
      method: 'vision',
    });
    expect(vision.calls).toHaveLength(2);
  });

  it('still transcribes every page of a scanned document exactly as long as the budget', async () => {
    const vision = createFakeVisionModel(() => 'transcribed');
    const bytes = buildSyntheticPdf([textPage(30), scannedPage]);
    const result = await extractText(
      { bytes, mime: PDF },
      { vision, limits: { maxVisionPages: 2 } },
    );
    expect(result.method).toBe('vision');
    expect(vision.calls).toHaveLength(2);
  });
});
