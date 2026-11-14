import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decode } from 'jpeg-js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeVisionModel } from '../../testing/fake-vision-model.ts';
import { buildSyntheticPdf, type SyntheticPdfPage } from '../../testing/synthetic-pdf.ts';
import { extractText } from '../extract-text.ts';
import { DEFAULT_TEXT_LIMITS, type TextLimits } from '../limits.ts';

const PDF = 'application/pdf';

interface Size {
  readonly width: number;
  readonly height: number;
}

const renderedSizes = async (
  pages: readonly SyntheticPdfPage[],
  limits: Partial<TextLimits> = {},
): Promise<readonly Size[]> => {
  const vision = createFakeVisionModel(() => '');
  await extractText(
    { bytes: buildSyntheticPdf(pages), mime: PDF },
    { vision, limits: { visionConcurrency: 1, ...limits } },
  );
  return vision.calls.map(({ image }) => {
    const { width, height } = decode(image, { useTArray: true });
    return { width, height };
  });
};

describe('extractText bounding the raster of a scanned page', () => {
  it('allows the long edge of an A3 page at 200 dpi by default', () => {
    expect(DEFAULT_TEXT_LIMITS.maxRenderEdgePx).toBe(3308);
  });

  it('renders an oversized page below 200 dpi, down to the pixel budget', async () => {
    // 1440 x 720 points would be 4000 x 2000 pixels at 200 dpi.
    const [size] = await renderedSizes([{ scanned: true, widthPt: 1440, heightPt: 720 }]);
    expect(size?.width).toBe(3308);
    // Half of 3308, rounded up or down depending on the poppler version.
    expect(size?.height).toBeGreaterThanOrEqual(1654);
    expect(size?.height).toBeLessThanOrEqual(1655);
  });

  it('bounds the longer edge whichever it is, page by page', async () => {
    const sizes = await renderedSizes(
      [
        { scanned: true, widthPt: 180, heightPt: 720 },
        { scanned: true, widthPt: 144, heightPt: 72 },
      ],
      { maxRenderEdgePx: 500 },
    );
    expect(sizes).toEqual([
      { width: 125, height: 500 },
      { width: 400, height: 200 },
    ]);
  });

  it('keeps 200 dpi for a page that exactly fills the budget', async () => {
    expect(
      await renderedSizes([{ scanned: true, widthPt: 180, heightPt: 90 }], {
        maxRenderEdgePx: 500,
      }),
    ).toEqual([{ width: 500, height: 250 }]);
  });

  // poppler 26.08 ignores `UserUnit`, so this passes with or without the multiplication in
  // `readPage`; it pins the bound for a poppler that would honour it.
  it('keeps a page that declares a user unit inside the budget', async () => {
    const sizes = await renderedSizes(
      [{ scanned: true, widthPt: 180, heightPt: 90, userUnit: 4 }],
      { maxRenderEdgePx: 500 },
    );
    expect(sizes).toEqual([{ width: 500, height: 250 }]);
  });

  it('renders the visible box of a page, not a larger media box', async () => {
    const page = { scanned: true, widthPt: 1440, heightPt: 720, cropBoxPt: [144, 72] } as const;
    expect(await renderedSizes([page])).toEqual([{ width: 400, height: 200 }]);
  });

  it('refuses a rendered page heavier than the image limit, before the vision call', async () => {
    const vision = createFakeVisionModel(() => '');
    const failure = extractText(
      { bytes: buildSyntheticPdf([{ scanned: true }]), mime: PDF },
      { vision, limits: { maxImageBytes: 100 } },
    );
    await expect(failure).rejects.toMatchObject({
      name: 'TextExtractionError',
      code: 'image_too_large',
      retryable: false,
    });
    expect(vision.calls).toHaveLength(0);
  });
});

describe('extractText with a renderer that writes nothing', () => {
  let tempRoot = '';

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'liasse-text-test-'));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('tells a renderer that exits 0 without its page from a missing binary', async () => {
    const vision = createFakeVisionModel(() => '');
    const command = join(tempRoot, 'silent-pdftoppm');
    await writeFile(command, '#!/bin/sh\nexit 0\n');
    await chmod(command, 0o755);
    const failure = extractText(
      { bytes: buildSyntheticPdf([{ scanned: true }]), mime: PDF },
      { vision, pdfRenderer: { tempRoot, command } },
    );
    await expect(failure).rejects.toMatchObject({
      name: 'TextExtractionError',
      code: 'pdf_renderer_no_output',
      retryable: false,
    });
    expect(vision.calls).toHaveLength(0);
  });
});
