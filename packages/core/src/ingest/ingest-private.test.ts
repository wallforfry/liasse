import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { documents } from '../db/schema/documents.ts';
import { syntheticPdf } from '../testing/synthetic-files.ts';
import { deleteDocument } from './delete-document.ts';
import { createIngestHarness, type IngestHarness } from './harness.test-helper.ts';
import { ingestFile } from './ingest-file.ts';

describe('ingestFile with the private flag', () => {
  let harness: IngestHarness;

  const flags = async (): Promise<readonly boolean[]> =>
    (await harness.database.db.select({ private: documents.private }).from(documents)).map(
      (row) => row.private,
    );

  const ingest = (flag?: boolean) =>
    ingestFile(harness.deps, {
      bytes: syntheticPdf('private flag'),
      filename: 'statement.pdf',
      source: 'api',
      ...(flag === undefined ? {} : { private: flag }),
    });

  beforeAll(async () => {
    harness = await createIngestHarness();
  });

  afterEach(async () => {
    await harness.reset();
  });

  afterAll(async () => {
    await harness.dispose();
  });

  it('creates a document that is not private unless asked', async () => {
    await ingest();
    expect(await flags()).toEqual([false]);
  });

  it('creates a private document when asked', async () => {
    await ingest(true);
    expect(await flags()).toEqual([true]);
  });

  it('raises the flag of a document that already exists', async () => {
    await ingest();
    expect(await ingest(true)).toMatchObject({ duplicate: true });
    expect(await flags()).toEqual([true]);
  });

  it('never lowers the flag when the bytes are handed back', async () => {
    await ingest(true);
    await ingest(false);
    await ingest();
    expect(await flags()).toEqual([true]);
  });

  it('revives a deleted document with the flag it is handed back with', async () => {
    const { id } = await ingest();
    await deleteDocument({ db: harness.database.db }, id);
    await ingest(true);
    expect(await flags()).toEqual([true]);
  });
});
