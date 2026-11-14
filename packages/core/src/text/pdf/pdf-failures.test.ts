import { existsSync } from 'node:fs';
import { chmod, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeVisionModel } from '../../testing/fake-vision-model.ts';
import { buildSyntheticPdf } from '../../testing/synthetic-pdf.ts';
import { extractText } from '../extract-text.ts';

const PDF = 'application/pdf';
const scan = buildSyntheticPdf([{ scanned: true }, { scanned: true }, { scanned: true }]);
const nativePages = Array.from({ length: 3 }, () => ({ lines: ['x'.repeat(60), 'x'.repeat(60)] }));

describe('extractText on a PDF it cannot read', () => {
  const vision = createFakeVisionModel(() => '');

  it('reports a password-protected PDF', async () => {
    const bytes = buildSyntheticPdf(nativePages, { userPassword: 'synthetic-password' });
    await expect(extractText({ bytes, mime: PDF }, { vision })).rejects.toMatchObject({
      name: 'TextExtractionError',
      code: 'pdf_encrypted',
    });
  });

  it.each([
    ['bytes that are not a PDF', new TextEncoder().encode('Dear Jane Doe, this is no PDF.')],
    ['a truncated PDF', buildSyntheticPdf(nativePages).slice(0, 300)],
    ['an empty file', new Uint8Array(0)],
  ])('reports %s as corrupt', async (_, bytes) => {
    await expect(extractText({ bytes, mime: PDF }, { vision })).rejects.toMatchObject({
      name: 'TextExtractionError',
      code: 'pdf_corrupt',
    });
  });

  it('reports a PDF without any page', async () => {
    const bytes = buildSyntheticPdf([]);
    await expect(extractText({ bytes, mime: PDF }, { vision })).rejects.toMatchObject({
      code: 'pdf_no_pages',
    });
  });

  it('refuses a PDF with more pages than the limit, and accepts one at the limit', async () => {
    const bytes = buildSyntheticPdf(nativePages);
    await expect(
      extractText({ bytes, mime: PDF }, { vision, limits: { maxPdfPages: 2 } }),
    ).rejects.toMatchObject({ code: 'pdf_too_many_pages' });
    const atLimit = await extractText({ bytes, mime: PDF }, { vision, limits: { maxPdfPages: 3 } });
    expect(atLimit.pages).toHaveLength(3);
  });

  it('leaves the bytes it was given untouched', async () => {
    const bytes = buildSyntheticPdf(nativePages);
    const copy = bytes.slice();
    await extractText({ bytes, mime: PDF }, { vision });
    expect(bytes).toEqual(copy);
  });
});

describe('extractText rendering a scanned PDF', () => {
  let tempRoot = '';

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'liasse-text-test-'));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  const fakeCommand = async (script: string): Promise<string> => {
    const command = join(tempRoot, 'fake-pdftoppm');
    await writeFile(command, `#!/bin/sh\n${script}\n`);
    await chmod(command, 0o755);
    return command;
  };

  it('works in a private directory and removes it afterwards', async () => {
    const seen: { mode: number; files: readonly string[] }[] = [];
    const vision = createFakeVisionModel(async () => {
      const [directory] = await readdir(tempRoot);
      const path = join(tempRoot, directory ?? '');
      seen.push({ mode: (await stat(path)).mode & 0o777, files: await readdir(path) });
      return '';
    });
    await extractText(
      { bytes: scan, mime: PDF },
      { vision, pdfRenderer: { tempRoot }, limits: { visionConcurrency: 1 } },
    );
    expect(seen).toHaveLength(3);
    expect(seen).toEqual(Array.from({ length: 3 }, () => ({ mode: 0o700, files: ['input.pdf'] })));
    expect(await readdir(tempRoot)).toEqual([]);
  });

  it('removes its directory when a vision call fails', async () => {
    const vision = createFakeVisionModel(() => Promise.reject(new Error('provider unavailable')));
    await expect(
      extractText({ bytes: scan, mime: PDF }, { vision, pdfRenderer: { tempRoot } }),
    ).rejects.toThrow('provider unavailable');
    expect(await readdir(tempRoot)).toEqual([]);
  });

  it('reports a missing pdftoppm', async () => {
    const vision = createFakeVisionModel(() => '');
    const command = join(tempRoot, 'no-such-pdftoppm');
    const failure = extractText(
      { bytes: scan, mime: PDF },
      { vision, pdfRenderer: { tempRoot, command } },
    );
    await expect(failure).rejects.toMatchObject({ code: 'pdf_renderer_missing' });
    await expect(failure).rejects.toThrow(/poppler-utils/);
    expect(await readdir(tempRoot)).toEqual([]);
  });

  it('kills a renderer that exceeds the timeout', async () => {
    const vision = createFakeVisionModel(() => '');
    const command = await fakeCommand('exec sleep 30');
    await expect(
      extractText(
        { bytes: scan, mime: PDF },
        { vision, pdfRenderer: { tempRoot, command }, limits: { renderTimeoutMs: 100 } },
      ),
    ).rejects.toMatchObject({ code: 'pdf_renderer_timeout' });
    expect(vision.calls).toHaveLength(0);
  });

  it('reports a renderer that fails, with what it wrote on stderr', async () => {
    const vision = createFakeVisionModel(() => '');
    const command = await fakeCommand('echo "Syntax Error: broken page" >&2; exit 1');
    const failure = extractText(
      { bytes: scan, mime: PDF },
      { vision, pdfRenderer: { tempRoot, command } },
    );
    await expect(failure).rejects.toMatchObject({ code: 'pdf_renderer_failed' });
    await expect(failure).rejects.toThrow(/Syntax Error: broken page/);
  });

  it('stops when the signal aborts between two pages', async () => {
    const controller = new AbortController();
    const vision = createFakeVisionModel(() => {
      controller.abort();
      return '';
    });
    await expect(
      extractText(
        { bytes: scan, mime: PDF },
        {
          vision,
          signal: controller.signal,
          pdfRenderer: { tempRoot },
          limits: { visionConcurrency: 1 },
        },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(vision.calls).toHaveLength(1);
    expect(await readdir(tempRoot)).toEqual([]);
  });

  it('kills the renderer when the signal aborts while it runs', async () => {
    const controller = new AbortController();
    const vision = createFakeVisionModel(() => '');
    const started = join(tempRoot, 'renderer-started');
    const command = await fakeCommand(`: > "${started}"; exec sleep 30`);
    const extraction = extractText(
      { bytes: scan, mime: PDF },
      { vision, signal: controller.signal, pdfRenderer: { tempRoot, command } },
    );
    const outcome = extraction.then(
      () => 'resolved',
      (error: unknown) => (error instanceof Error ? error.name : 'unknown'),
    );
    while (!existsSync(started)) await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort();
    expect(await outcome).toBe('AbortError');
    expect(vision.calls).toHaveLength(0);
  });
});
