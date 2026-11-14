import { readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
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

export const isIgnoredPath = (relativePath: string): boolean => {
  const segments = relativePath.split(sep);
  const name = (segments.at(-1) ?? '').toLowerCase();
  return (
    segments.some((segment) => segment.startsWith('.')) ||
    TEMPORARY_SUFFIXES.some((suffix) => name.endsWith(suffix)) ||
    TEMPORARY_PREFIXES.some((prefix) => name.startsWith(prefix))
  );
};

/** Regular files under `dir`, at any depth. Symbolic links are neither listed nor followed. */
export const listWatchedFiles = async (dir: string): Promise<readonly string[]> => {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((path) => !isIgnoredPath(relative(dir, path)));
};

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
