import { mkdir, open, rename, rm, writeFile } from 'node:fs/promises';

/**
 * The file system calls whose order decides what survives a power loss. They are a
 * seam because that order is the only part of durability a test can observe. Each
 * call does one thing, so that leaving a sync out shows in the calls made.
 */
export interface DurableFs {
  /** Creates the directory and its missing parents. Resolves to the topmost one it created. */
  readonly makeDirectory: (path: string) => Promise<string | undefined>;
  /** Creates a file, refusing an existing one. Its content is not durable yet. */
  readonly writeFile: (path: string, bytes: Uint8Array) => Promise<void>;
  /** Makes the content of a file durable. */
  readonly syncFile: (path: string) => Promise<void>;
  readonly rename: (from: string, to: string) => Promise<void>;
  /** Removes a file; an absent one is not an error. */
  readonly removeFile: (path: string) => Promise<void>;
  /** Makes durable the entries created in, renamed into or removed from the directory. */
  readonly syncDirectory: (path: string) => Promise<void>;
}

// `fsync` works on the file behind a descriptor, whichever descriptor wrote to it.
const sync = async (path: string, flags: 'r' | 'r+'): Promise<void> => {
  const handle = await open(path, flags);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
};

export const nodeDurableFs: DurableFs = {
  makeDirectory: (path) => mkdir(path, { recursive: true }),
  writeFile: (path, bytes) => writeFile(path, bytes, { flag: 'wx' }),
  syncFile: (path) => sync(path, 'r+'),
  rename,
  removeFile: (path) => rm(path, { force: true }),
  syncDirectory: (path) => sync(path, 'r'),
};
