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

  // pdfjs multiplies the page box by `UserUnit` and poppler ignores it, so a size taken
  // from pdfjs made this page look 9 points wide and let it be rendered at 25000 pixels.
  it('bounds a huge page that declares a user unit below 1', async () => {
    const [size] = await renderedSizes([
      { scanned: true, widthPt: 9000, heightPt: 9000, userUnit: 0.001 },
    ]);
    expect(size).toEqual({ width: 3308, height: 3308 });
  });

  it.each([0.01, 1, 4])('bounds a page whose user unit is %d', async (userUnit) => {
    const sizes = await renderedSizes([{ scanned: true, widthPt: 900, heightPt: 450, userUnit }], {
      maxRenderEdgePx: 500,
    });
    expect(sizes).toEqual([{ width: 500, height: 250 }]);
  });

  it('never enlarges a page smaller than the budget', async () => {
    expect(
      await renderedSizes([{ scanned: true, widthPt: 72, heightPt: 36 }], {
        maxRenderEdgePx: 500,
      }),
    ).toEqual([{ width: 200, height: 100 }]);
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

  it('does not ask for another attempt when poppler rejects the geometry of a page', async () => {
    const vision = createFakeVisionModel(() => '');
    const command = join(tempRoot, 'failing-pdftoppm');
    const message = 'Internal Error: JpegWriter::init: hDPI or vDPI values are invalid 360000.';
    await writeFile(command, `#!/bin/sh\necho "${message}" >&2\nexit 1\n`);
    await chmod(command, 0o755);
    const failure = extractText(
      { bytes: buildSyntheticPdf([{ scanned: true }]), mime: PDF },
      { vision, pdfRenderer: { tempRoot, command } },
    );
    await expect(failure).rejects.toMatchObject({
      name: 'TextExtractionError',
      code: 'pdf_page_unrenderable',
      retryable: false,
    });
    await expect(failure).rejects.toThrow(/hDPI or vDPI values are invalid/);
  });

  it('refuses output that is not a JPEG image', async () => {
    const vision = createFakeVisionModel(() => '');
    const command = join(tempRoot, 'garbage-pdftoppm');
    await writeFile(
      command,
      '#!/bin/sh\nfor last; do :; done\necho "not an image" > "$last.jpg"\n',
    );
    await chmod(command, 0o755);
    await expect(
      extractText(
        { bytes: buildSyntheticPdf([{ scanned: true }]), mime: PDF },
        { vision, pdfRenderer: { tempRoot, command } },
      ),
    ).rejects.toMatchObject({ code: 'pdf_renderer_no_output', retryable: false });
    expect(vision.calls).toHaveLength(0);
  });

  const fakeInfoCommand = async (script: string): Promise<string> => {
    const infoCommand = join(tempRoot, 'fake-pdfinfo');
    await writeFile(infoCommand, `#!/bin/sh\n${script}\n`);
    await chmod(infoCommand, 0o755);
    return infoCommand;
  };
  const wide = buildSyntheticPdf([{ scanned: true, widthPt: 1440, heightPt: 720 }]);

  it('never sends an image larger than the budget, even when the size was misreported', async () => {
    const vision = createFakeVisionModel(() => '');
    const infoCommand = await fakeInfoCommand('echo "Page    1 size:  9 x 9 pts"');
    const failure = extractText(
      { bytes: wide, mime: PDF },
      { vision, pdfRenderer: { tempRoot, infoCommand } },
    );
    await expect(failure).rejects.toMatchObject({
      code: 'pdf_page_unrenderable',
      retryable: false,
    });
    await expect(failure).rejects.toThrow(/4000x2000 pixels/);
    expect(vision.calls).toHaveLength(0);
  });

  it('takes the size of a page from pdfinfo', async () => {
    const vision = createFakeVisionModel(() => '');
    const infoCommand = await fakeInfoCommand('echo "Page    1 size:  144 x 9000.5 pts (odd)"');
    await extractText(
      { bytes: buildSyntheticPdf([{ scanned: true, widthPt: 144, heightPt: 72 }]), mime: PDF },
      { vision, pdfRenderer: { tempRoot, infoCommand }, limits: { maxRenderEdgePx: 300 } },
    );
    const { width, height } = decode(vision.calls[0]?.image ?? new Uint8Array(0), {
      useTArray: true,
    });
    expect({ width, height }).toEqual({ width: 300, height: 150 });
  });

  it('refuses to render a page whose size pdfinfo does not report', async () => {
    const vision = createFakeVisionModel(() => '');
    const infoCommand = await fakeInfoCommand('echo "Pages:           1"');
    const failure = extractText(
      { bytes: wide, mime: PDF },
      { vision, pdfRenderer: { tempRoot, infoCommand } },
    );
    await expect(failure).rejects.toMatchObject({ code: 'pdf_renderer_no_output' });
    await expect(failure).rejects.toThrow(/did not report the size of page 1/);
    expect(vision.calls).toHaveLength(0);
  });

  it('reports a missing pdfinfo', async () => {
    const vision = createFakeVisionModel(() => '');
    const infoCommand = join(tempRoot, 'no-such-pdfinfo');
    await expect(
      extractText({ bytes: wide, mime: PDF }, { vision, pdfRenderer: { tempRoot, infoCommand } }),
    ).rejects.toMatchObject({ code: 'pdf_renderer_missing', retryable: false });
  });
});
