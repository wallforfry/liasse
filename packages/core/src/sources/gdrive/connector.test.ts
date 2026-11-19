import { createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deleteDocument } from '../../ingest/delete-document.ts';
import { SourceFileUnavailableError } from '../../ingest/document-file.ts';
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

  it('never downloads nor reports a file that no supported format matches', async () => {
    const { drive } = harness.google;
    const folder = drive.folder('Mixed');
    drive.file('kept.pdf', folder, syntheticPdf('kept'));
    drive.file('scan.PDF', folder, syntheticPdf('scan'), 'application/octet-stream');
    const leftOut = [
      drive.file('film.torrent', folder, syntheticPdf('torrent'), 'application/x-bittorrent'),
      drive.file('clip.MOV', folder, syntheticPdf('clip'), 'video/quicktime'),
      drive.file('README', folder, syntheticPdf('readme'), 'application/octet-stream'),
    ];
    const source = await harness.addDriveSource(folder);

    await harness.poll(source);

    expect(await names()).toEqual(['kept.pdf', 'scan.PDF']);
    expect(await harness.lastRun(source)).toMatchObject({
      ingested: 2,
      skipped: 0,
      skipped_items: [],
      error: null,
    });
    const downloads = harness.google.driveRequests().filter((call) => call.includes('alt=media'));
    expect(downloads).toHaveLength(2);
    expect(downloads.filter((call) => leftOut.some((id) => call.includes(id)))).toEqual([]);
  });

  it.each([
    'cannotDownloadAbusiveFile',
    'cannotDownloadFile',
    'insufficientFilePermissions',
    'appNotAuthorizedToFile',
  ])('skips a file Drive refuses with 403 %s, and reads the others', async (reason) => {
    const { drive } = harness.google;
    const folder = drive.folder('Refused');
    const refused = drive.file('refused.pdf', folder, syntheticPdf('refused'));
    drive.refuse(refused, { status: 403, reason });
    drive.file('after.pdf', folder, syntheticPdf('after'));
    const source = await harness.addDriveSource(folder);

    await harness.poll(source);

    expect(await names()).toEqual(['after.pdf']);
    const run = await harness.lastRun(source);
    expect(run).toMatchObject({ ingested: 1, skipped: 1, error: null });
    expect(run.skipped_items).toMatchObject([{ external_id: refused, name: 'refused.pdf' }]);
    expect(run.skipped_items[0]?.reason).toContain(reason);
  });

  it.each([
    { status: 403, reason: 'userRateLimitExceeded' },
    { status: 403, reason: 'rateLimitExceeded' },
    { status: 403, reason: 'downloadQuotaExceeded' },
    { status: 429, reason: 'rateLimitExceeded' },
    { status: 429, reason: 'anythingElse' },
  ])('ends the run on a limit ($status $reason), for the retries', async (refusal) => {
    const { drive } = harness.google;
    const folder = drive.folder('Limited');
    const limited = drive.file('limited.pdf', folder, syntheticPdf('limited'));
    drive.refuse(limited, refusal);
    const source = await harness.addDriveSource(folder);

    await expect(harness.poll(source)).rejects.toThrow(/a later attempt resumes/);

    expect(await names()).toEqual([]);
    const run = await harness.lastRun(source);
    expect(run).toMatchObject({ skipped: 0, error: { kind: 'transient' } });
    expect(run.error?.message).toContain(refusal.reason);
  });

  it.each([
    { status: 500, reason: 'cannotDownloadFile', of: 'download' },
    { status: 403, reason: 'insufficientFilePermissions', of: 'metadata' },
  ] as const)(
    'ends the run when $status $reason refuses the $of, never skipping the file',
    async (refusal) => {
      const { drive } = harness.google;
      const folder = drive.folder('Not a file refusal');
      const file = drive.file('held.pdf', folder, syntheticPdf('held'));
      // The metadata a run reads is that of its folder; a download is that of the file.
      drive.refuse(refusal.of === 'metadata' ? folder : file, refusal);
      const source = await harness.addDriveSource(folder);

      await expect(harness.poll(source)).rejects.toThrow(
        `Drive answered ${String(refusal.status)} to files (${refusal.reason}).`,
      );

      const run = await harness.lastRun(source);
      expect(run).toMatchObject({ skipped: 0, skipped_items: [], error: { kind: 'transient' } });
    },
  );

  it('answers a stored file Drive now refuses to serve as unavailable', async () => {
    const { drive } = harness.google;
    const folder = drive.folder('Flagged later');
    const file = drive.file('flagged.pdf', folder, syntheticPdf('flagged'));
    const source = await harness.addDriveSource(folder);
    await harness.poll(source);
    const [document] = await harness.liveDocuments();
    if (document === undefined) throw new Error('The file was not ingested');
    drive.refuse(file, { status: 403, reason: 'cannotDownloadAbusiveFile' });

    await expect(harness.sourceFiles().open(document.id)).rejects.toBeInstanceOf(
      SourceFileUnavailableError,
    );
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

  it('brings back the document of an earlier version a file is restored to', async () => {
    const { drive } = harness.google;
    const folder = drive.folder('Restored');
    const first = syntheticPdf('version 1');
    const file = drive.file('contract.pdf', folder, first);
    const source = await harness.addDriveSource(folder);
    await harness.poll(source);
    const [original] = await harness.liveDocuments();
    drive.update(file, syntheticPdf('version 2'));
    await harness.poll(source);

    drive.update(file, first);
    await harness.poll(source);

    const live = await harness.liveDocuments();
    expect(live.map(({ id, sha256 }) => [id, sha256])).toEqual([[original?.id, sha256Of(first)]]);
    expect(live[0]).toMatchObject({ fileAtSource: true, storageKey: null });
    expect((await harness.origins()).map(({ documentId }) => documentId)).toEqual([original?.id]);
  });

  it('leaves deleted the bytes a person deleted, even when Drive holds them again', async () => {
    const { drive } = harness.google;
    const folder = drive.folder('Deleted');
    const first = syntheticPdf('deleted by a person');
    const file = drive.file('letter.pdf', folder, first);
    const source = await harness.addDriveSource(folder);
    await harness.poll(source);
    const [deleted] = await harness.liveDocuments();
    await deleteDocument({ db: harness.ingest.database.db }, deleted?.id ?? '');
    drive.update(file, syntheticPdf('a later version'));
    await harness.poll(source);

    drive.update(file, first);
    await harness.poll(source);

    expect((await harness.liveDocuments()).map(({ id }) => id)).not.toContain(deleted?.id);
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
