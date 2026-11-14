import { readFile } from 'node:fs/promises';
import { encode } from 'jpeg-js';
import { describe, expect, it } from 'vitest';
import { buildSyntheticPng } from '../../testing/synthetic-png.ts';
import { readJpegSize } from './jpeg-size.ts';

describe('readJpegSize', () => {
  it('reads the size of a JPEG that carries metadata before its frame', async () => {
    const fixture = new URL('../fixtures/gradient-64x48.jpg', import.meta.url);
    expect(readJpegSize(Uint8Array.from(await readFile(fixture)))).toEqual({
      width: 64,
      height: 48,
    });
  });

  it('reads the size of an encoded image', () => {
    const { data } = encode({ data: new Uint8Array(300 * 7 * 4), width: 300, height: 7 }, 90);
    expect(readJpegSize(Uint8Array.from(data))).toEqual({ width: 300, height: 7 });
  });

  // A frame header for a 64 x 48 image: marker, length 17, precision, height, width.
  const frame = [
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    0x00,
    0x30,
    0x00,
    0x40,
    ...new Array<number>(10).fill(0),
  ];
  const start = [0xff, 0xd8];

  it('skips a Huffman table, whose marker sits among the frame markers', () => {
    const table = [0xff, 0xc4, 0x00, 0x09, 1, 2, 3, 4, 5, 6, 7];
    expect(readJpegSize(Uint8Array.from([...start, ...table, ...frame]))).toEqual({
      width: 64,
      height: 48,
    });
  });

  it.each([
    [
      'a frame after the start of the scan',
      Uint8Array.from([...start, 0xff, 0xda, 0x00, 0x04, 0, 0, ...frame]),
    ],
    ['a frame without the start of an image', Uint8Array.from([0x00, 0x00, ...frame])],
    ['an empty file', new Uint8Array(0)],
    ['a PNG', buildSyntheticPng(8, 8)],
    ['text', new TextEncoder().encode('not an image')],
    ['a JPEG cut before its frame', Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])],
    [
      'a segment that points past the end',
      Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xff, 0, 0, 0, 0, 0]),
    ],
  ])('returns nothing for %s', (_, bytes) => {
    expect(readJpegSize(bytes)).toBeUndefined();
  });
});
