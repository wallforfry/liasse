import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { DOCUMENTS_DIRECTORY } from '../corpus.ts';
import { encodeJpeg } from '../render/jpeg.ts';
import { heicSource } from '../render/render-document.ts';
import { SCENARIO, type ScenarioDocument } from '../scenario/index.ts';

const run = promisify(execFile);

// High enough that the HEIC encoder starts from the picture, not from JPEG artefacts.
const SOURCE_JPEG_QUALITY = 95;
// Out of 100, as `sips` counts it: a phone photo is not stored any finer.
const HEIC_QUALITY = '60';
const HEIC_EXTENSION = '.heic';

export const heicDocuments = (): readonly ScenarioDocument[] =>
  SCENARIO.filter(({ render }) => render.kind === 'image' && render.encoding === 'heic');

// The HEIC files a corpus directory already holds, by document id.
export const readHeicFiles = async (
  directory: string,
): Promise<ReadonlyMap<string, Uint8Array>> => {
  const documents = join(directory, DOCUMENTS_DIRECTORY);
  const names = await readdir(documents).catch(() => []);
  const found = await Promise.all(
    heicDocuments().map(async ({ id }) => {
      const name = names.find((candidate) => candidate.endsWith(`-${id}${HEIC_EXTENSION}`));
      return name === undefined
        ? []
        : [[id, Uint8Array.from(await readFile(join(documents, name)))] as const];
    }),
  );
  return new Map(found.flat());
};

// Encodes the HEIC files again with `sips`, which only macOS has. The result depends on
// the version of the system: it is committed, and compared with its source picture by a
// test rather than byte for byte.
export const encodeHeicFiles = async (): Promise<ReadonlyMap<string, Uint8Array>> => {
  const work = await mkdtemp(join(tmpdir(), 'liasse-eval-heic-'));
  try {
    const encoded = await Promise.all(
      heicDocuments().map(async (document) => {
        const source = join(work, `${document.id}.jpg`);
        const target = join(work, `${document.id}${HEIC_EXTENSION}`);
        await writeFile(source, encodeJpeg(heicSource(document), SOURCE_JPEG_QUALITY));
        await run('sips', [
          '-s',
          'format',
          'heic',
          '-s',
          'formatOptions',
          HEIC_QUALITY,
          source,
          '--out',
          target,
        ]);
        return [document.id, Uint8Array.from(await readFile(target))] as const;
      }),
    );
    return new Map(encoded);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
};
