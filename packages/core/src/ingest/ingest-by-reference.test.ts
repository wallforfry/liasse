import { createHash } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { documents } from '../db/schema/documents.ts';
import { syntheticPdf } from '../testing/synthetic-files.ts';
import { createDeleteFileHandler } from './delete-file-job.ts';
import { deleteDocument } from './delete-document.ts';
import { createIngestHarness, type IngestHarness } from './harness.test-helper.ts';
import { ingestFile } from './ingest-file.ts';

describe('a file ingested by reference', () => {
  let harness: IngestHarness;

  beforeAll(async () => {
    harness = await createIngestHarness();
  });

  afterAll(async () => {
    await harness.dispose();
  });

  beforeEach(async () => {
    await harness.reset();
  });

  const byReference = (bytes: Uint8Array) =>
    ingestFile(harness.deps, {
      bytes,
      filename: 'kept.pdf',
      source: 'connector',
      byReference: true,
    });
  const asCopy = (bytes: Uint8Array) =>
    ingestFile(harness.deps, { bytes, filename: 'copy.pdf', source: 'api' });
  const rowOf = async (id: string) => {
    const [row] = await harness.database.db.select().from(documents).where(eq(documents.id, id));
    return row;
  };

  it('writes nothing to the storage and says the file is at its source', async () => {
    const { id } = await byReference(syntheticPdf('reference'));
    expect(await rowOf(id)).toMatchObject({ storageKey: null, fileAtSource: true });
    expect(harness.puts()).toBe(0);
  });

  it('becomes a stored copy as soon as a copy brings the same bytes', async () => {
    const bytes = syntheticPdf('then copied');
    const { id } = await byReference(bytes);
    const copy = await asCopy(bytes);
    expect(copy).toMatchObject({ id, duplicate: true });
    expect(await rowOf(id)).toMatchObject({ fileAtSource: false });
    expect((await rowOf(id))?.storageKey).not.toBeNull();
    expect(await harness.storedFiles()).toHaveLength(1);
  });

  it('leaves a stored copy stored when a source finds the same bytes', async () => {
    const bytes = syntheticPdf('copied first');
    const { id } = await asCopy(bytes);
    await byReference(bytes);
    expect(await rowOf(id)).toMatchObject({ fileAtSource: false });
    expect(harness.puts()).toBe(1);
  });

  it('cannot be a document with its file neither stored nor at a source', async () => {
    const { id } = await byReference(syntheticPdf('constrained'));
    await expect(
      harness.database.db.execute(
        sql`UPDATE documents SET file_at_source = false WHERE id = ${id}`,
      ),
    ).rejects.toThrow();
  });

  it('owes no file removal once deleted, and touches no storage', async () => {
    const bytes = syntheticPdf('deleted');
    const { id } = await byReference(bytes);
    expect(await deleteDocument({ db: harness.database.db }, id)).toBe(true);
    await createDeleteFileHandler(harness.deps).run(
      { documentId: id },
      { signal: new AbortController().signal, attempt: 1 },
    );
    const row = await rowOf(id);
    expect(row?.fileDeletedAt).toBeInstanceOf(Date);
    expect(row?.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
  });
});
