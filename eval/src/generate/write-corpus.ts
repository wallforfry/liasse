import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { DOCUMENTS_DIRECTORY } from '../corpus.ts';
import type { BuiltCorpus } from './build-corpus.ts';

// Writes the corpus under `directory` and removes the documents a previous generation
// left there that the scenario no longer has.
export const writeCorpus = async (directory: string, { files }: BuiltCorpus): Promise<void> => {
  const documents = join(directory, DOCUMENTS_DIRECTORY);
  await mkdir(documents, { recursive: true });
  const kept = new Set(files.map(({ path }) => path));
  const stale = (await readdir(documents)).filter(
    (name) => !kept.has(`${DOCUMENTS_DIRECTORY}/${name}`),
  );
  await Promise.all(stale.map((name) => rm(join(documents, name))));
  await Promise.all(
    files.map(async ({ path, bytes }) => {
      const target = join(directory, ...path.split('/'));
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes);
    }),
  );
};
