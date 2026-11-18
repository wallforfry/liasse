import { createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ingestFile } from '../../ingest/ingest-file.ts';
import { syntheticPdf } from '../../testing/synthetic-files.ts';
import { openSourceSecret } from '../secret.ts';
import { storedSource, TEST_SECRETS } from '../sources.test-helper.ts';
import { createDriveHarness, type DriveHarness } from './gdrive.test-helper.ts';

const sha256Of = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

describe('a Drive source', () => {
  let harness: DriveHarness;

  beforeAll(async () => {
    harness = await createDriveHarness();
  });

  afterAll(async () => {
    await harness.dispose();
  });

  beforeEach(async () => {
    await harness.reset();
  });

  const names = async () =>
    (await harness.liveDocuments()).map(({ originalName }) => originalName).sort();

  it('ingests the folder and its subfolders by reference, never storing their bytes', async () => {
    const { drive } = harness.google;
    const folder = drive.folder('Invoices');
    const sub = drive.folder('2026', folder);
    drive.file('outside.pdf', drive.rootId, syntheticPdf('outside'));
    const bytes = syntheticPdf('top');
    drive.file('top.pdf', folder, bytes);
    drive.file('deep.pdf', sub, syntheticPdf('deep'));
    drive.file('third.pdf', sub, syntheticPdf('third'));
    drive.googleDoc('Notes', folder);
    const source = await harness.addDriveSource(folder);

    await harness.poll(source);

    expect(await names()).toEqual(['deep.pdf', 'third.pdf', 'top.pdf']);
    const top = (await harness.liveDocuments()).find(({ sha256 }) => sha256 === sha256Of(bytes));
    expect(top).toMatchObject({ storageKey: null, fileAtSource: true, source: 'connector' });
    expect(await harness.ingest.storedFiles()).toEqual([]);
    expect((await harness.origins()).map(({ checksum }) => checksum)).toContain(
      createHash('md5').update(bytes).digest('hex'),
    );
    expect(await harness.lastRun(source)).toMatchObject({ ingested: 3, error: null });
  });

  it('asks every Drive call to include shared drives', async () => {
    const { drive } = harness.google;
    const folder = drive.folder('Shared');
    drive.file('a.pdf', folder, syntheticPdf('a'));
    await harness.poll(await harness.addDriveSource(folder));
    const calls = harness.google.driveRequests();
    expect(calls.length).toBeGreaterThan(0);
    expect(
      calls.every(
        (call) => new URL(call, 'http://x').searchParams.get('supportsAllDrives') === 'true',
      ),
    ).toBe(true);
  });

  it('takes later files from the changes, and lists a folder moved into the tree', async () => {
    const { drive } = harness.google;
    const folder = drive.folder('Inbox');
    // Older than the source: no change of the feed will name its file.
    const elsewhere = drive.folder('Elsewhere');
    drive.file('moved-in.pdf', elsewhere, syntheticPdf('moved-in'));
    const source = await harness.addDriveSource(folder);
    await harness.poll(source);
    expect(await names()).toEqual([]);

    drive.file('later.pdf', folder, syntheticPdf('later'));
    drive.move(elsewhere, folder);
    await harness.poll(source);

    expect(await names()).toEqual(['later.pdf', 'moved-in.pdf']);
  });

  it('follows a shortcut once, to a file only', async () => {
    const { drive } = harness.google;
    const folder = drive.folder('Links');
    const target = drive.file('target.pdf', drive.rootId, syntheticPdf('target'));
    const otherFolder = drive.folder('Other');
    drive.file('in-other.pdf', otherFolder, syntheticPdf('in-other'));
    drive.shortcut('to target', folder, target);
    drive.shortcut('to folder', folder, otherFolder);
    const source = await harness.addDriveSource(folder);

    await harness.poll(source);

    expect(await names()).toEqual(['target.pdf']);
  });

  it('marks a trashed file removed, keeps its document, and clears the mark on a restore', async () => {
    const { drive } = harness.google;
    const folder = drive.folder('Archive');
    const file = drive.file('kept.pdf', folder, syntheticPdf('kept'));
    const source = await harness.addDriveSource(folder);
    await harness.poll(source);

    drive.trash(file);
    await harness.poll(source);
    expect(await names()).toEqual(['kept.pdf']);
    expect((await harness.origins())[0]?.removedAt).toBeInstanceOf(Date);
    expect(await harness.lastRun(source)).toMatchObject({ removed: 1 });

    drive.restore(file);
    await harness.poll(source);
    expect((await harness.origins())[0]?.removedAt).toBeNull();
  });

  it('marks removed the files of a folder moved out of the tree', async () => {
    const { drive } = harness.google;
    const folder = drive.folder('Tree');
    const sub = drive.folder('Leaving', folder);
    drive.file('inside.pdf', sub, syntheticPdf('inside'));
    const source = await harness.addDriveSource(folder);
    await harness.poll(source);

    drive.move(sub, drive.rootId);
    await harness.poll(source);

    expect((await harness.origins())[0]?.removedAt).toBeInstanceOf(Date);
    // The folder left the tree: a file added to it later is not read.
    drive.file('after.pdf', sub, syntheticPdf('after'));
    await harness.poll(source);
    expect(await names()).toEqual(['inside.pdf']);
  });

  it('replaces the document of a file whose checksum changed, deleting the old one', async () => {
    const { drive } = harness.google;
    const folder = drive.folder('Contracts');
    const file = drive.file('contract.pdf', folder, syntheticPdf('version 1'));
    const source = await harness.addDriveSource(folder);
    await harness.poll(source);
    const [first] = await harness.liveDocuments();

    const second = syntheticPdf('version 2');
    drive.update(file, second);
    await harness.poll(source);

    const live = await harness.liveDocuments();
    expect(live.map(({ sha256 }) => sha256)).toEqual([sha256Of(second)]);
    expect(live[0]?.id).not.toBe(first?.id);
    expect(await harness.lastRun(source)).toMatchObject({ ingested: 1, replaced: 1 });
    expect((await harness.origins()).map(({ documentId }) => documentId)).toEqual([live[0]?.id]);
  });

  it('keeps a document that a stored copy holds when its Drive file changes', async () => {
    const { drive } = harness.google;
    const folder = drive.folder('Mixed');
    const bytes = syntheticPdf('copied');
    const file = drive.file('copied.pdf', folder, bytes);
    const source = await harness.addDriveSource(folder);
    await harness.poll(source);
    await ingestFile(harness.ingest.deps, { bytes, filename: 'copied.pdf', source: 'api' });

    drive.update(file, syntheticPdf('copied, changed'));
    await harness.poll(source);

    expect((await harness.liveDocuments()).map(({ sha256 }) => sha256)).toContain(sha256Of(bytes));
  });
});

describe('a Drive source whose authorization was revoked', () => {
  let harness: DriveHarness;

  beforeAll(async () => {
    harness = await createDriveHarness();
  });

  afterAll(async () => {
    await harness.dispose();
  });

  it('needs attention, as a refused password does', async () => {
    const { drive } = harness.google;
    const folder = drive.folder('Revoked');
    const source = await harness.addDriveSource(folder);
    const { secret } = await storedSource(harness.ingest.database.db, source);
    const token = openSourceSecret(TEST_SECRETS, source, secret);
    if (token.state !== 'set') throw new Error('The source has no token');
    await fetch(harness.google.endpoints.revoke, {
      method: 'POST',
      body: new URLSearchParams({ token: token.value }),
    });

    await harness.poll(source);

    expect(await storedSource(harness.ingest.database.db, source)).toMatchObject({
      needsAttention: true,
    });
    expect(await harness.lastRun(source)).toMatchObject({ error: { kind: 'credentials' } });
  });
});
