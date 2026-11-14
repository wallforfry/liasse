import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { documentPages, documents } from '../db/schema/documents.ts';
import { createGate, sleep } from '../testing/async.ts';
import { syntheticPdf } from '../testing/synthetic-files.ts';
import { deleteDocument } from './delete-document.ts';
import type { Transaction } from './existing-document.ts';
import { createIngestHarness, type IngestHarness } from './harness.test-helper.ts';
import { ingestFile } from './ingest-file.ts';
import { writeIfLive } from './live-write.ts';

describe('writeIfLive', () => {
  let harness: IngestHarness;

  const ingest = async (label: string): Promise<string> =>
    (
      await ingestFile(harness.deps, {
        bytes: syntheticPdf(label),
        filename: `${label}.pdf`,
        source: 'api',
      })
    ).id;

  // What a pipeline handler writes at the end of its work.
  const writeResult = (id: string) => async (tx: Transaction) => {
    await tx
      .update(documents)
      .set({ status: 'extracted', title: 'Synthetic' })
      .where(eq(documents.id, id));
    await tx.insert(documentPages).values({ documentId: id, page: 1, text: 'synthetic page' });
    return 'done';
  };

  const row = async (id: string) =>
    (await harness.database.db.select().from(documents).where(eq(documents.id, id)))[0];

  beforeAll(async () => {
    harness = await createIngestHarness();
  });

  afterEach(async () => {
    await harness.reset();
  });

  afterAll(async () => {
    await harness.dispose();
  });

  it('writes to a live document and returns what the write returned', async () => {
    const id = await ingest('live');
    expect(await writeIfLive(harness.database.db, id, writeResult(id))).toEqual({
      written: true,
      result: 'done',
    });
    expect(await row(id)).toMatchObject({ status: 'extracted', title: 'Synthetic' });
  });

  it('writes nothing to a deleted document, nor to one that does not exist', async () => {
    const id = await ingest('deleted before the write');
    await deleteDocument(harness.deps, id);
    let called = false;
    const write = async (tx: Transaction) => {
      called = true;
      return writeResult(id)(tx);
    };
    expect(await writeIfLive(harness.database.db, id, write)).toEqual({ written: false });
    expect(await writeIfLive(harness.database.db, 'doc_synthetic_missing', write)).toEqual({
      written: false,
    });
    expect(called).toBe(false);
    expect(await row(id)).toMatchObject({ status: 'deleted', title: null });
    expect(await harness.database.db.select().from(documentPages)).toEqual([]);
  });

  it('makes a deletion wait for the write, then delete what was written', async () => {
    const id = await ingest('deleted during the write');
    const writing = createGate();
    const proceed = createGate();
    // The write touches a derived table only: nothing but the lock taken by
    // `writeIfLive` stands between it and the deletion.
    const write = writeIfLive(harness.database.db, id, async (tx) => {
      await tx.insert(documentPages).values({ documentId: id, page: 1, text: 'synthetic page' });
      writing.open();
      await proceed.opened;
      return 'done';
    });
    await writing.opened;
    const deletion = deleteDocument(harness.deps, id);
    const deletedDuringTheWrite = await Promise.race([
      deletion.then(() => true),
      sleep(300).then(() => false),
    ]);
    proceed.open();
    expect(await write).toEqual({ written: true, result: 'done' });
    expect(await deletion).toBe(true);
    expect(deletedDuringTheWrite).toBe(false);
    expect(await row(id)).toMatchObject({ status: 'deleted', title: null });
    expect(await harness.database.db.select().from(documentPages)).toEqual([]);
  });

  it('rolls the write back when it throws', async () => {
    const id = await ingest('failing write');
    await expect(
      writeIfLive(harness.database.db, id, async (tx) => {
        await writeResult(id)(tx);
        throw new Error('synthetic failure');
      }),
    ).rejects.toThrow('synthetic failure');
    expect(await row(id)).toMatchObject({ status: 'received', title: null });
  });
});
