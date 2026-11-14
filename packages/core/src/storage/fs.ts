import { randomBytes } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { StorageObjectNotFoundError } from './errors.ts';
import type { StorageKey } from './key.ts';
import { isFileNotFound } from './node-errors.ts';
import type { Storage } from './port.ts';

const writeDurably = async (path: string, bytes: Uint8Array): Promise<void> => {
  const handle = await open(path, 'wx');
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
};

const notFoundAsTyped = (error: unknown): never => {
  if (isFileNotFound(error)) throw new StorageObjectNotFoundError({ cause: error });
  throw error;
};

export const createFsStorage = (root: string): Storage => {
  const pathOf = (key: StorageKey): string => join(root, key);

  return {
    put: async (key, bytes) => {
      const target = pathOf(key);
      await mkdir(dirname(target), { recursive: true });
      // The temporary file sits next to its target: `rename` is atomic only within one
      // file system. Its name is no valid key, so a leftover is never served.
      const temporary = `${target}.${randomBytes(8).toString('hex')}.tmp`;
      try {
        await writeDurably(temporary, bytes);
        await rename(temporary, target);
      } catch (error) {
        await rm(temporary, { force: true });
        throw error;
      }
    },
    get: async (key) => {
      try {
        return await readFile(pathOf(key));
      } catch (error) {
        return notFoundAsTyped(error);
      }
    },
    // Opening first turns a missing file into a rejection, not a late stream error.
    getStream: async (key) => {
      try {
        const handle = await open(pathOf(key), 'r');
        return handle.createReadStream();
      } catch (error) {
        return notFoundAsTyped(error);
      }
    },
    exists: async (key) => {
      try {
        return (await stat(pathOf(key))).isFile();
      } catch (error) {
        if (isFileNotFound(error)) return false;
        throw error;
      }
    },
    delete: async (key) => {
      await rm(pathOf(key), { force: true });
    },
  };
};
