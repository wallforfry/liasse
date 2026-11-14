import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { isFileNotFound } from '../storage/node-errors.ts';

// What browsers, editors, office suites and sync tools leave while they write a file.
const TEMPORARY_SUFFIXES = [
  '~',
  '.tmp',
  '.temp',
  '.part',
  '.partial',
  '.crdownload',
  '.download',
  '.swp',
];
const TEMPORARY_PREFIXES = ['~$'];

/** True for a file the watcher leaves alone and for a directory it does not enter. */
export const isIgnoredName = (name: string): boolean => {
  const lowered = name.toLowerCase();
  return (
    name.startsWith('.') ||
    TEMPORARY_SUFFIXES.some((suffix) => lowered.endsWith(suffix)) ||
    TEMPORARY_PREFIXES.some((prefix) => lowered.startsWith(prefix))
  );
};

export interface UnreadableDirectory {
  readonly path: string;
  readonly error: unknown;
}

export interface WatchListing {
  /** Regular files, at any depth. Symbolic links are neither listed nor followed. */
  readonly files: readonly string[];
  /** Directories below the watched one that could not be read; their content is missing. */
  readonly unreadable: readonly UnreadableDirectory[];
}

const EMPTY: WatchListing = { files: [], unreadable: [] };

// The tree is walked one directory at a time. `readdir` with `recursive` rejects as a
// whole on the first directory it cannot read, and a single `lost+found` owned by root
// would then hide every other file of the folder.
const listDirectory = async (directory: string, isRoot: boolean): Promise<WatchListing> => {
  const entries = await readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
    if (isRoot) throw error;
    return { path: directory, error };
  });
  if (!Array.isArray(entries))
    return isFileNotFound(entries.error) ? EMPTY : { files: [], unreadable: [entries] };

  const visible = entries.filter((entry) => !isIgnoredName(entry.name));
  const below: WatchListing[] = [];
  for (const entry of visible.filter((candidate) => candidate.isDirectory())) {
    below.push(await listDirectory(join(directory, entry.name), false));
  }
  return {
    files: [
      ...visible.filter((entry) => entry.isFile()).map((entry) => join(directory, entry.name)),
      ...below.flatMap(({ files }) => files),
    ],
    unreadable: below.flatMap(({ unreadable }) => unreadable),
  };
};

/** Rejects when the watched directory itself cannot be read. */
export const listWatchedFiles = (directory: string): Promise<WatchListing> =>
  listDirectory(directory, true);

/** Changes whenever the file is written to. Undefined once the file is gone. */
export const fingerprintOf = async (path: string): Promise<string | undefined> => {
  try {
    const { size, mtimeMs } = await stat(path);
    return `${String(size)}:${String(mtimeMs)}`;
  } catch (error) {
    if (isFileNotFound(error)) return undefined;
    throw error;
  }
};
