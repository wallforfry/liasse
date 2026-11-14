import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decode } from 'jpeg-js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeVisionModel, type FakeVisionModel } from '../../testing/fake-vision-model.ts';
import { buildSyntheticPdf } from '../../testing/synthetic-pdf.ts';
import { extractText } from '../extract-text.ts';

const PDF = 'application/pdf';

const sizesSeenBy = (vision: FakeVisionModel) =>
  vision.calls.map(({ image }) => {
    const { width, height } = decode(image, { useTArray: true });
    return { width, height };
  });

describe('extractText measuring a page of a PDF that forges a size', () => {
  // pdfinfo prints the document information before the page sizes and leaves these two
  // line separators as they are.
  it.each([
    ['Title', ' '],
    ['Title', ' '],
    ['Subject', ' '],
    ['Keywords', ' '],
  ])('ignores a size line forged in %s after %j', async (field, separator) => {
    const vision = createFakeVisionModel(() => '');
    const bytes = buildSyntheticPdf([{ scanned: true, widthPt: 1440, heightPt: 720 }], {
      info: { [field]: `x${separator}Page    1 size:  10 x 10 pts` },
    });
    await extractText({ bytes, mime: PDF }, { vision });
    expect(sizesSeenBy(vision).map(({ width }) => width)).toEqual([3308]);
  });

  it('reads the size of a page after more than a mebibyte of document information', async () => {
    const vision = createFakeVisionModel(() => '');
    const bytes = buildSyntheticPdf([{ scanned: true, widthPt: 144, heightPt: 72 }], {
      info: { Title: 'Jane Doe '.repeat(140_000) },
    });
    await extractText({ bytes, mime: PDF }, { vision });
    expect(sizesSeenBy(vision)).toEqual([{ width: 400, height: 200 }]);
  });

  it('accepts the extra pixel poppler adds to a square page scaled to the budget', async () => {
    const vision = createFakeVisionModel(() => '');
    const bytes = buildSyntheticPdf([{ scanned: true, widthPt: 1191, heightPt: 1191 }]);
    await extractText({ bytes, mime: PDF }, { vision });
    const [size] = sizesSeenBy(vision);
    expect(Math.min(size?.width ?? 0, size?.height ?? 0)).toBe(3308);
    expect(Math.max(size?.width ?? 0, size?.height ?? 0)).toBeLessThanOrEqual(3309);
  });
});

describe('extractText with a pdfinfo that reports an odd size', () => {
  let tempRoot = '';

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'liasse-text-test-'));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  const fakeInfoCommand = async (...lines: readonly string[]): Promise<string> => {
    const infoCommand = join(tempRoot, 'fake-pdfinfo');
    await writeFile(
      infoCommand,
      `#!/bin/sh\n${lines.map((line) => `echo "${line}"`).join('\n')}\n`,
    );
    await chmod(infoCommand, 0o755);
    return infoCommand;
  };

  it('scales to the budget a page whose size is reported twice', async () => {
    const vision = createFakeVisionModel(() => '');
    const infoCommand = await fakeInfoCommand(
      'Page    1 size:  10 x 10 pts',
      'Page    1 size:  144 x 72 pts',
    );
    await extractText(
      { bytes: buildSyntheticPdf([{ scanned: true, widthPt: 144, heightPt: 72 }]), mime: PDF },
      { vision, pdfRenderer: { tempRoot, infoCommand }, limits: { maxRenderEdgePx: 300 } },
    );
    expect(sizesSeenBy(vision)).toEqual([{ width: 300, height: 150 }]);
  });

  // Only the end of the output is kept. A long line of document information can be cut
  // right where it holds a forged size, which must not then pass for the start of a line.
  it('does not read a size from the cut end of a longer line', async () => {
    const vision = createFakeVisionModel(() => '');
    const keptBytes = 16 * 1024;
    const forged = 'Page    1 size:  10 x 10 pts\n';
    const kept = `${forged}File size:       ${'7'.repeat(keptBytes - forged.length - 18)}\n`;
    expect(kept).toHaveLength(keptBytes);
    const outputFile = join(tempRoot, 'pdfinfo-output');
    await writeFile(outputFile, `Title:          ${'x'.repeat(5000)}${kept}`);
    const infoCommand = join(tempRoot, 'cut-pdfinfo');
    await writeFile(infoCommand, `#!/bin/sh\ncat "${outputFile}"\n`);
    await chmod(infoCommand, 0o755);
    const failure = extractText(
      { bytes: buildSyntheticPdf([{ scanned: true, widthPt: 144, heightPt: 72 }]), mime: PDF },
      { vision, pdfRenderer: { tempRoot, infoCommand } },
    );
    await expect(failure).rejects.toThrow(/did not report the size of page 1/);
    expect(vision.calls).toHaveLength(0);
  });

  it('keeps a page without area as it is, without a vision call', async () => {
    const vision = createFakeVisionModel(() => 'transcribed');
    const infoCommand = await fakeInfoCommand('Page    2 size:  0 x 0 pts');
    const bytes = buildSyntheticPdf([
      { lines: Array.from({ length: 6 }, () => 'x'.repeat(50)) },
      { scanned: true },
    ]);
    const result = await extractText(
      { bytes, mime: PDF },
      { vision, pdfRenderer: { tempRoot, infoCommand } },
    );
    expect(result.pages[1]).toEqual({ page: 2, text: '', method: 'native' });
    expect(result.method).toBe('native');
    expect(vision.calls).toHaveLength(0);
  });
});
