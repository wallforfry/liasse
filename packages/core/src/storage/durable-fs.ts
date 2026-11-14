import { mkdir, open, rename } from 'node:fs/promises';

/**
 * The file system calls whose order decides what survives a power loss. They are a
 * seam because that order is the only part of durability a test can observe.
 */
export interface DurableFs {
  /** Creates the directory and its missing parents. Resolves to the topmost one it created. */
  readonly makeDirectory: (path: string) => Promise<string | undefined>;
  /** Creates a file, refusing an existing one, and syncs its content. */
  readonly writeFile: (path: string, bytes: Uint8Array) => Promise<void>;
  readonly rename: (from: string, to: string) => Promise<void>;
  /** Makes durable the entries created in, or renamed into, the directory. */
  readonly syncDirectory: (path: string) => Promise<void>;
}

export const nodeDurableFs: DurableFs = {
  makeDirectory: (path) => mkdir(path, { recursive: true }),
  writeFile: async (path, bytes) => {
    const handle = await open(path, 'wx');
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
  },
  rename,
  syncDirectory: async (path) => {
    const handle = await open(path, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  },
};
