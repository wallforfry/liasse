const CENTRAL_ENTRY_SIGNATURE = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
const CENTRAL_HEADER_BYTES = 46;
const END_RECORD_BYTES = 22;

export const CENTRAL_FIELDS = {
  method: { offset: 10, bytes: 2 },
  compressedSize: { offset: 20, bytes: 4 },
  nameLength: { offset: 28, bytes: 2 },
  localOffset: { offset: 42, bytes: 4 },
} as const;

const centralEntryOf = (archive: Buffer, name: string): number => {
  const nameAt = archive.lastIndexOf(Buffer.from(name, 'utf8'));
  const entry = nameAt - CENTRAL_HEADER_BYTES;
  if (nameAt === -1 || !archive.subarray(entry, entry + 4).equals(CENTRAL_ENTRY_SIGNATURE)) {
    throw new Error(`The synthetic archive has no central directory entry for ${name}`);
  }
  return entry;
};

/** A copy of the archive with one field of the central directory entry of `name` rewritten. */
export const withCentralField = (
  archive: Uint8Array,
  name: string,
  field: keyof typeof CENTRAL_FIELDS,
  value: number,
): Uint8Array => {
  const patched = Buffer.from(archive);
  const { offset, bytes } = CENTRAL_FIELDS[field];
  const at = centralEntryOf(patched, name) + offset;
  if (bytes === 2) patched.writeUInt16LE(value, at);
  else patched.writeUInt32LE(value, at);
  return Uint8Array.from(patched);
};

/**
 * A copy of the archive whose central directory stops in the middle of the entry of
 * `name`, followed by the untouched end record: a download cut short and then closed.
 */
export const withDirectoryCutAt = (archive: Uint8Array, name: string): Uint8Array => {
  const whole = Buffer.from(archive);
  const cut = centralEntryOf(whole, name) + CENTRAL_HEADER_BYTES / 2;
  return Uint8Array.from(
    Buffer.concat([whole.subarray(0, cut), whole.subarray(whole.length - END_RECORD_BYTES)]),
  );
};
