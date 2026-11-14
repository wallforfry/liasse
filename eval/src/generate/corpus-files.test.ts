import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CORPUS_DIRECTORY } from '../corpus.ts';
import { heicSource } from '../render/render-document.ts';
import { type BuiltCorpus, buildCorpus } from './build-corpus.ts';
import { heicDocuments, readHeicFiles } from './heic.ts';
import { writeCorpus } from './write-corpus.ts';

// Largest size the committed corpus may reach: it is cloned with the repository.
const MAX_CORPUS_BYTES = 3 * 1024 * 1024;
// Mean difference of grey level, out of 255, between a decoded HEIC and its source: the
// loss of a lossy encoder stays far below it, another picture far above.
const MAX_HEIC_DIFFERENCE = 12;

const listFiles = async (directory: string): Promise<readonly string[]> => {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(directory, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .sort();
};

describe('the committed corpus', () => {
  let regenerated = '';
  let heic: ReadonlyMap<string, Uint8Array>;
  let built: BuiltCorpus;

  beforeAll(async () => {
    heic = await readHeicFiles(CORPUS_DIRECTORY);
    built = buildCorpus(heic);
    regenerated = await mkdtemp(join(tmpdir(), 'liasse-eval-corpus-'));
    await writeCorpus(regenerated, built);
  });

  afterAll(async () => {
    await rm(regenerated, { recursive: true, force: true });
  });

  it('holds exactly the files the generator writes', async () => {
    expect(await listFiles(CORPUS_DIRECTORY)).toEqual(await listFiles(regenerated));
  });

  it('holds them byte for byte', async () => {
    const paths = await listFiles(regenerated);
    const different = await Promise.all(
      paths.map(async (path) => {
        const [committed, generated] = await Promise.all([
          readFile(join(CORPUS_DIRECTORY, path)),
          readFile(join(regenerated, path)),
        ]);
        return committed.equals(generated) ? [] : [path];
      }),
    );
    expect(different.flat()).toEqual([]);
  });

  it('gives the same bytes at every generation', () => {
    const again = buildCorpus(heic);
    expect(again.files.map(({ path }) => path)).toEqual(built.files.map(({ path }) => path));
    expect(
      again.files
        .filter(
          ({ bytes }, index) =>
            !Buffer.from(bytes).equals(Buffer.from(built.files[index]?.bytes ?? [])),
        )
        .map(({ path }) => path),
    ).toEqual([]);
  });

  it('stays small enough to live in the repository', () => {
    expect(built.files.reduce((total, { bytes }) => total + bytes.length, 0)).toBeLessThan(
      MAX_CORPUS_BYTES,
    );
  });

  // The one file the generator cannot write again: it is checked against the picture it
  // was encoded from instead of byte for byte.
  it.each(heicDocuments())(
    'holds a HEIC of $id that shows its source picture',
    async (document) => {
      const { default: decode } = await import('heic-decode');
      const committed = heic.get(document.id);
      expect(committed).toBeDefined();
      const decoded = await decode({ buffer: committed ?? new Uint8Array() });
      const source = heicSource(document);
      expect([decoded.width, decoded.height]).toEqual([source.width, source.height]);
      const difference =
        source.data.reduce(
          (total, tone, pixel) => total + Math.abs(tone - (decoded.data[pixel * 4] ?? 0)),
          0,
        ) / source.data.length;
      expect(difference).toBeLessThan(MAX_HEIC_DIFFERENCE);
    },
  );
});
