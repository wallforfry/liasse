import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { buildSyntheticZip } from '../testing/synthetic-zip.ts';
import { withCentralField, withDirectoryCutAt } from './zip-damage.test-helper.ts';
import { locateZipEntry, ZipFormatError } from './zip.ts';

const text = (value: string): Uint8Array => new TextEncoder().encode(value);

const archive = (): Uint8Array =>
  buildSyntheticZip([
    { name: 'a.txt', data: text('one'), stored: true },
    { name: 'dir/b.txt', data: text('two two two two') },
  ]);

const failure = (bytes: Uint8Array, name: string): unknown => {
  try {
    locateZipEntry(bytes, name);
    return undefined;
  } catch (error) {
    return error;
  }
};

describe('locateZipEntry', () => {
  it('returns the bytes of a stored entry as they are', () => {
    expect(locateZipEntry(archive(), 'a.txt')).toEqual({
      name: 'a.txt',
      compression: 'stored',
      data: text('one'),
    });
  });

  it('returns the bytes of a deflated entry still compressed', () => {
    const entry = locateZipEntry(archive(), 'dir/b.txt');
    expect(entry?.compression).toBe('deflated');
    expect(inflateRawSync(entry?.data ?? new Uint8Array(0)).toString()).toBe('two two two two');
  });

  it('returns nothing for a name the directory does not list', () => {
    expect(locateZipEntry(archive(), 'missing.txt')).toBeUndefined();
  });

  it('finds the directory of an archive that ends with a comment', () => {
    const commented = Buffer.from(archive());
    commented.writeUInt16LE(9, commented.length - 2);
    const bytes = Uint8Array.from(Buffer.concat([commented, Buffer.from('synthetic')]));
    expect(locateZipEntry(bytes, 'a.txt')?.data).toEqual(text('one'));
  });

  it('reads a view over a larger buffer from its own offset', () => {
    const bytes = archive();
    const padded = new Uint8Array(bytes.length + 16);
    padded.set(bytes, 16);
    expect(locateZipEntry(padded.subarray(16), 'a.txt')?.data).toEqual(text('one'));
  });

  it('does not read past the entry it was asked for', () => {
    const damaged = withCentralField(archive(), 'dir/b.txt', 'localOffset', 5);
    expect(locateZipEntry(damaged, 'a.txt')?.data).toEqual(text('one'));
  });

  it.each([
    [
      'bytes that are no archive',
      text('Just a synthetic note.'),
      'a.txt',
      'no end of central directory',
    ],
    ['an empty file', new Uint8Array(0), 'a.txt', 'no end of central directory'],
    [
      'a directory offset outside the archive',
      (() => {
        const bytes = Buffer.from(archive());
        bytes.writeUInt32LE(0xfffffff0, bytes.length - 6);
        return Uint8Array.from(bytes);
      })(),
      'a.txt',
      'truncated archive',
    ],
    [
      'a directory offset that is not an entry',
      (() => {
        const bytes = Buffer.from(archive());
        bytes.writeUInt32LE(0, bytes.length - 6);
        return Uint8Array.from(bytes);
      })(),
      'a.txt',
      'bad central directory entry',
    ],
    [
      'a directory cut before the entry',
      withDirectoryCutAt(archive(), 'a.txt'),
      'dir/b.txt',
      'truncated archive',
    ],
    [
      'an entry name that runs past the end',
      withCentralField(archive(), 'dir/b.txt', 'nameLength', 0xffff),
      'dir/b.txt',
      'truncated archive',
    ],
    [
      'an entry that points away from its file header',
      withCentralField(archive(), 'dir/b.txt', 'localOffset', 5),
      'dir/b.txt',
      'bad local file header',
    ],
    [
      'an entry that points outside the archive',
      withCentralField(archive(), 'dir/b.txt', 'localOffset', 0xfffffff0),
      'dir/b.txt',
      'truncated archive',
    ],
    [
      'file data that runs past the end',
      withCentralField(archive(), 'dir/b.txt', 'compressedSize', 0xffff),
      'dir/b.txt',
      'truncated file data',
    ],
    [
      'a compression method other than stored and deflated',
      withCentralField(archive(), 'dir/b.txt', 'method', 12),
      'dir/b.txt',
      'unsupported compression method',
    ],
  ])('refuses %s', (_label, bytes, name, reason) => {
    const error = failure(bytes, name);
    expect(error).toBeInstanceOf(ZipFormatError);
    expect(error).toMatchObject({ message: reason });
  });
});
