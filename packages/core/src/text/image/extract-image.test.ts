import { readFile } from 'node:fs/promises';
import { decode } from 'jpeg-js';
import { describe, expect, it } from 'vitest';
import { createFakeVisionModel } from '../../testing/fake-vision-model.ts';
import { buildSyntheticPng } from '../../testing/synthetic-png.ts';
import { extractText } from '../extract-text.ts';
import { TRANSCRIPTION_PROMPT } from '../transcription-prompt.ts';

const fixture = async (name: string): Promise<Uint8Array> =>
  Uint8Array.from(await readFile(new URL(`../fixtures/${name}`, import.meta.url)));

const sizeOf = (jpeg: Uint8Array): { readonly width: number; readonly height: number } => {
  const { width, height } = decode(jpeg, { useTArray: true });
  return { width, height };
};

describe('extractText on an image', () => {
  it('sends a PNG to the vision model as it is', async () => {
    const vision = createFakeVisionModel(() => '# Receipt\n\nTotal: 12.00 EUR');
    const bytes = buildSyntheticPng(64, 48);
    expect(await extractText({ bytes, mime: 'image/png' }, { vision })).toEqual({
      pages: [{ page: 1, text: '# Receipt\n\nTotal: 12.00 EUR', method: 'vision' }],
      method: 'vision',
      visionModel: 'fake-vision-model',
      attachments: [],
    });
    expect(vision.calls).toEqual([
      { image: bytes, mime: 'image/png', prompt: TRANSCRIPTION_PROMPT },
    ]);
  });

  it('sends a JPEG to the vision model as it is', async () => {
    const vision = createFakeVisionModel(() => 'Jane Doe');
    const bytes = await fixture('gradient-64x48.jpg');
    const result = await extractText({ bytes, mime: 'image/jpeg' }, { vision });
    expect(result.pages).toEqual([{ page: 1, text: 'Jane Doe', method: 'vision' }]);
    expect(vision.calls).toEqual([
      { image: bytes, mime: 'image/jpeg', prompt: TRANSCRIPTION_PROMPT },
    ]);
  });

  it('converts a HEIC image to JPEG before the vision call', async () => {
    const vision = createFakeVisionModel(() => 'Jane Doe');
    const bytes = await fixture('gradient-64x48.heic');
    const result = await extractText({ bytes, mime: 'image/heic' }, { vision });
    expect(result.pages).toEqual([{ page: 1, text: 'Jane Doe', method: 'vision' }]);
    expect(result.method).toBe('vision');
    expect(vision.calls).toHaveLength(1);
    expect(vision.calls[0]?.mime).toBe('image/jpeg');
    expect(sizeOf(vision.calls[0]?.image ?? new Uint8Array(0))).toEqual({ width: 64, height: 48 });
  });

  it('downscales a HEIC image whose longer edge exceeds the limit', async () => {
    const vision = createFakeVisionModel(() => '');
    const bytes = await fixture('gradient-64x48.heic');
    await extractText({ bytes, mime: 'image/heic' }, { vision, limits: { maxHeicEdgePx: 32 } });
    expect(sizeOf(vision.calls[0]?.image ?? new Uint8Array(0))).toEqual({ width: 32, height: 24 });
  });

  it('refuses a HEIC image with more pixels than the limit, without decoding it', async () => {
    const vision = createFakeVisionModel(() => '');
    const bytes = await fixture('gradient-64x48.heic');
    await expect(
      extractText(
        { bytes, mime: 'image/heic' },
        { vision, limits: { maxHeicPixels: 64 * 48 - 1 } },
      ),
    ).rejects.toMatchObject({ name: 'TextExtractionError', code: 'image_too_large' });
    const atLimit = await extractText(
      { bytes, mime: 'image/heic' },
      { vision, limits: { maxHeicPixels: 64 * 48 } },
    );
    expect(atLimit.pages).toHaveLength(1);
  });

  it('treats an empty transcription as an empty page', async () => {
    const vision = createFakeVisionModel(() => '');
    const bytes = buildSyntheticPng(8, 8);
    expect((await extractText({ bytes, mime: 'image/png' }, { vision })).pages).toEqual([
      { page: 1, text: '', method: 'vision' },
    ]);
  });

  it('refuses an image heavier than the limit, and accepts one at the limit', async () => {
    const vision = createFakeVisionModel(() => '');
    const bytes = buildSyntheticPng(64, 48);
    await expect(
      extractText(
        { bytes, mime: 'image/png' },
        { vision, limits: { maxImageBytes: bytes.length - 1 } },
      ),
    ).rejects.toMatchObject({ code: 'image_too_large' });
    expect(vision.calls).toHaveLength(0);
    await extractText(
      { bytes, mime: 'image/png' },
      { vision, limits: { maxImageBytes: bytes.length } },
    );
    expect(vision.calls).toHaveLength(1);
  });

  it.each([
    ['text declared as PNG', new TextEncoder().encode('Dear Jane Doe'), 'image/png'],
    ['a PNG declared as JPEG', buildSyntheticPng(8, 8), 'image/jpeg'],
    ['an empty file declared as JPEG', new Uint8Array(0), 'image/jpeg'],
    ['a PNG declared as HEIC', buildSyntheticPng(8, 8), 'image/heic'],
    ['an empty file declared as HEIC', new Uint8Array(0), 'image/heic'],
  ] as const)('reports %s as corrupt without a vision call', async (_, bytes, mime) => {
    const vision = createFakeVisionModel(() => '');
    await expect(extractText({ bytes, mime }, { vision })).rejects.toMatchObject({
      name: 'TextExtractionError',
      code: 'image_corrupt',
    });
    expect(vision.calls).toHaveLength(0);
  });

  it('reports a truncated HEIC image as corrupt', async () => {
    const vision = createFakeVisionModel(() => '');
    const bytes = (await fixture('gradient-64x48.heic')).slice(0, 600);
    await expect(extractText({ bytes, mime: 'image/heic' }, { vision })).rejects.toMatchObject({
      code: 'image_corrupt',
    });
  });
});
