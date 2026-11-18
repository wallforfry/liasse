import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { documentPages, documents } from '../db/schema/documents.ts';
import { documentLinks } from '../db/schema/knowledge.ts';
import { createGate, waitUntil } from '../testing/async.ts';
import { backendPid, holdsBack } from '../testing/lock-waits.ts';
import { syntheticPdf } from '../testing/synthetic-files.ts';
import { deleteDocument } from './delete-document.ts';
import type { Transaction } from './existing-document.ts';
import { createIngestHarness, type IngestHarness } from './harness.test-helper.ts';
import { ingestFile } from './ingest-file.ts';
import { writeIfBothLive, writeIfLive } from './live-write.ts';

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
    const writing = createGate<number>();
    const proceed = createGate();
    // The write touches a derived table only: nothing but the lock taken by
    // `writeIfLive` stands between it and the deletion.
    const write = writeIfLive(harness.database.db, id, async (tx) => {
      await tx.insert(documentPages).values({ documentId: id, page: 1, text: 'synthetic page' });
      writing.open(await backendPid(tx));
      await proceed.opened;
      return 'done';
    });
    const writer = await writing.opened;
    const deletion = deleteDocument(harness.deps, id);
    try {
      await waitUntil(() => holdsBack(harness.database.db, writer));
    } finally {
      proceed.open();
      await Promise.allSettled([write, deletion]);
    }
    expect(await write).toEqual({ written: true, result: 'done' });
    expect(await deletion).toBe(true);
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

  it('runs inside a transaction of the caller, which keeps the row until it ends', async () => {
    const id = await ingest('inside a transaction');
    const written = createGate<number>();
    const proceed = createGate();
    const outer = harness.database.db.transaction(async (tx) => {
      const outcome = await writeIfLive(tx, id, writeResult(id));
      written.open(await backendPid(tx));
      await proceed.opened;
      return outcome;
    });
    const writer = await written.opened;
    const deletion = deleteDocument(harness.deps, id);
    try {
      await waitUntil(() => holdsBack(harness.database.db, writer));
    } finally {
      proceed.open();
      await Promise.allSettled([outer, deletion]);
    }
    expect(await outer).toEqual({ written: true, result: 'done' });
    expect(await deletion).toBe(true);
    expect(await harness.database.db.select().from(documentPages)).toEqual([]);
  });
});

describe('writeIfBothLive', () => {
  let harness: IngestHarness;

  const ingest = async (label: string): Promise<string> =>
    (
      await ingestFile(harness.deps, {
        bytes: syntheticPdf(label),
        filename: `${label}.pdf`,
        source: 'api',
      })
    ).id;

  const link = (from: string, to: string) => (tx: Transaction) =>
    tx
      .insert(documentLinks)
      .values({ fromDocumentId: from, toDocumentId: to, kind: 'attachment_of' })
      .then(() => 'linked');

  const links = () =>
    harness.database.db
      .select({ from: documentLinks.fromDocumentId, to: documentLinks.toDocumentId })
      .from(documentLinks);

  beforeAll(async () => {
    harness = await createIngestHarness();
  });

  afterEach(async () => {
    await harness.database.db.delete(documentLinks);
    await harness.reset();
  });

  afterAll(async () => {
    await harness.dispose();
  });

  it('writes a row over two live documents', async () => {
    const [a, c] = [await ingest('a'), await ingest('c')];
    expect(await writeIfBothLive(harness.database.db, [a, c], link(a, c))).toEqual({
      written: true,
      result: 'linked',
    });
    expect(await links()).toEqual([{ from: a, to: c }]);
  });

  it('writes nothing when either document is deleted or does not exist', async () => {
    const [a, gone] = [await ingest('a'), await ingest('gone')];
    await deleteDocument(harness.deps, gone);
    for (const pair of [
      [a, gone],
      [gone, a],
      [a, 'doc_synthetic_missing'],
    ] as const) {
      expect(await writeIfBothLive(harness.database.db, pair, link(pair[0], pair[1]))).toEqual({
        written: false,
      });
    }
    expect(await links()).toEqual([]);
  });

  it('makes the deletion of either document wait, then remove the row', async () => {
    const [a, c] = [await ingest('a'), await ingest('c')];
    const writing = createGate<number>();
    const proceed = createGate();
    const write = writeIfBothLive(harness.database.db, [a, c], async (tx) => {
      await link(a, c)(tx);
      writing.open(await backendPid(tx));
      await proceed.opened;
    });
    const writer = await writing.opened;
    const deletion = deleteDocument(harness.deps, c);
    try {
      await waitUntil(() => holdsBack(harness.database.db, writer));
    } finally {
      proceed.open();
      await Promise.allSettled([write, deletion]);
    }
    await write;
    expect(await deletion).toBe(true);
    expect(await links()).toEqual([]);
  });

  // `FOR UPDATE` on the two rows would hold this insert back until the link commits:
  // that wait is one half of the deadlock between two handlers linking A to C and C to A.
  it('does not hold back the foreign-key check of a row that references one of the two', async () => {
    const [a, c] = [await ingest('a'), await ingest('c')];
    const proceed = createGate();
    const holding = createGate();
    const write = writeIfBothLive(harness.database.db, [a, c], async () => {
      holding.open();
      await proceed.opened;
    });
    await holding.opened;
    await harness.database.db
      .insert(documentPages)
      .values({ documentId: c, page: 1, text: 'synthetic page' });
    proceed.open();
    await write;
    expect(await harness.database.db.select().from(documentPages)).toHaveLength(1);
  });

  it('lets two writers link A to C and C to A at once', async () => {
    const [a, c] = [await ingest('a'), await ingest('c')];
    const outcomes = await Promise.all([
      writeIfBothLive(harness.database.db, [a, c], link(a, c)),
      writeIfBothLive(harness.database.db, [c, a], link(c, a)),
    ]);
    expect(outcomes.map(({ written }) => written)).toEqual([true, true]);
    expect(await links()).toHaveLength(2);
  });
});
