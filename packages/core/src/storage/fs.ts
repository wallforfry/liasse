import { randomBytes } from 'node:crypto';
import { open, readFile, rm, stat } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { type DurableFs, nodeDurableFs } from './durable-fs.ts';
import { StorageObjectNotFoundError } from './errors.ts';
import type { StorageKey } from './key.ts';
import { isFileNotFound } from './node-errors.ts';
import type { Storage } from './port.ts';

const notFoundAsTyped = (error: unknown): never => {
  if (isFileNotFound(error)) throw new StorageObjectNotFoundError({ cause: error });
  throw error;
};

// From the directory that received the file up to the storage root, always: a
// concurrent `put` may be the one that created a shard directory, and would sync its
// parent only after this one resolved. Above the root only when the root was created.
const directoriesToSync = (
  directory: string,
  root: string,
  topmostCreated: string | undefined,
): string[] => {
  const createdBelowRoot =
    topmostCreated === undefined || /^[^.]/.test(relative(root, topmostCreated));
  const stop = createdBelowRoot ? root : dirname(topmostCreated);
  const upwards = (current: string): string[] =>
    current === stop || dirname(current) === current
      ? [current]
      : [current, ...upwards(dirname(current))];
  return upwards(directory);
};

export const createFsStorage = (root: string, fs: DurableFs = nodeDurableFs): Storage => {
  const pathOf = (key: StorageKey): string => join(root, key);

  return {
    put: async (key, bytes) => {
      const target = pathOf(key);
      const directory = dirname(target);
      const created = await fs.makeDirectory(directory);
      // The temporary file sits next to its target: `rename` is atomic only within one
      // file system. Its name is no valid key, so a leftover is never served.
      const temporary = `${target}.${randomBytes(8).toString('hex')}.tmp`;
      try {
        await fs.writeFile(temporary, bytes);
        await fs.rename(temporary, target);
      } catch (error) {
        await rm(temporary, { force: true });
        throw error;
      }
      // A rename and a mkdir are durable once the directory holding the new entry is
      // synced. Without it a power loss can leave a committed document without its file.
      for (const changed of directoriesToSync(directory, root, created)) {
        await fs.syncDirectory(changed);
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
