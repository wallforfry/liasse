import { crc32, deflateRawSync } from 'node:zlib';

export interface SyntheticZipEntry {
  readonly name: string;
  readonly data: Uint8Array;
  readonly stored?: boolean;
  // Lies about the expanded size, as a decompression bomb does.
  readonly declaredSize?: number;
}

interface PackedEntry {
  readonly local: Uint8Array;
  readonly central: Uint8Array;
}

const DEFLATED = 8;
const STORED = 0;
const VERSION = 20;

const fields = (...values: readonly (readonly [bytes: 2 | 4, value: number])[]): Uint8Array => {
  const buffer = new Uint8Array(values.reduce((total, [bytes]) => total + bytes, 0));
  const view = new DataView(buffer.buffer);
  values.reduce((offset, [bytes, value]) => {
    if (bytes === 2) view.setUint16(offset, value, true);
    else view.setUint32(offset, value, true);
    return offset + bytes;
  }, 0);
  return buffer;
};

const packEntry = (entry: SyntheticZipEntry, localOffset: number): PackedEntry => {
  const name = Buffer.from(entry.name, 'utf8');
  const content = entry.stored === true ? entry.data : deflateRawSync(entry.data);
  const shared = [
    [2, 0],
    [2, entry.stored === true ? STORED : DEFLATED],
    [2, 0],
    [2, 0],
    [4, crc32(entry.data)],
    [4, content.length],
    [4, entry.declaredSize ?? entry.data.length],
    [2, name.length],
    [2, 0],
  ] as const;
  return {
    local: Buffer.concat([fields([4, 0x04034b50], [2, VERSION], ...shared), name, content]),
    central: Buffer.concat([
      fields(
        [4, 0x02014b50],
        [2, VERSION],
        [2, VERSION],
        ...shared,
        [2, 0],
        [2, 0],
        [2, 0],
        [4, 0],
        [4, localOffset],
      ),
      name,
    ]),
  };
};

// Writes a ZIP archive by hand so that tests can also produce the malformed ones.
export const buildSyntheticZip = (entries: readonly SyntheticZipEntry[]): Uint8Array => {
  const packed = entries.reduce<readonly PackedEntry[]>(
    (done, entry) => [
      ...done,
      packEntry(
        entry,
        done.reduce((total, { local }) => total + local.length, 0),
      ),
    ],
    [],
  );
  const locals = Buffer.concat(packed.map(({ local }) => local));
  const centrals = Buffer.concat(packed.map(({ central }) => central));
  const end = fields(
    [4, 0x06054b50],
    [2, 0],
    [2, 0],
    [2, entries.length],
    [2, entries.length],
    [4, centrals.length],
    [4, locals.length],
    [2, 0],
  );
  return Uint8Array.from(Buffer.concat([locals, centrals, end]));
};
