import { type FakeDriveState, fileResource } from './fake-drive.ts';
import type { FakeReply } from './fake-oauth.ts';

// Small pages, so that every listing of a test crosses a page boundary.
const PAGE_SIZE = 2;

/** A reply of the Drive API: JSON, or the bytes of a file. */
export type DriveReply = FakeReply | { readonly status: 200; readonly bytes: Uint8Array };

const page = <Entry>(entries: readonly Entry[], token: string | null) => {
  const start = token === null ? 0 : Number(token);
  const next = start + PAGE_SIZE;
  return {
    entries: entries.slice(start, next),
    next: next < entries.length ? String(next) : undefined,
  };
};

const changes = (drive: FakeDriveState, url: URL): FakeReply => {
  const start = Number(url.searchParams.get('pageToken'));
  const { entries, next } = page(drive.changesSince(start), null);
  return {
    status: 200,
    body: {
      changes: entries.map(({ fileId }) => {
        const file = drive.get(fileId);
        return file === undefined
          ? { changeType: 'file', fileId, removed: true }
          : { changeType: 'file', fileId, removed: false, file: fileResource(file) };
      }),
      ...(next === undefined
        ? { newStartPageToken: String(drive.position()) }
        : { nextPageToken: String(start + Number(next)) }),
    },
  };
};

const listing = (drive: FakeDriveState, url: URL): FakeReply => {
  const query = /^'([^']+)' in parents( and trashed = false)?$/.exec(
    url.searchParams.get('q') ?? '',
  );
  if (query?.[1] === undefined) {
    return { status: 400, body: { error: { message: 'unsupported query' } } };
  }
  const listed = drive.children(query[1], query[2] === undefined).map(fileResource);
  const { entries, next } = page(listed, url.searchParams.get('pageToken'));
  return {
    status: 200,
    body: { files: entries, ...(next === undefined ? {} : { nextPageToken: next }) },
  };
};

/** What the Drive API v3 answers to an authorized request of the calls a Drive source makes. */
export const driveReply = (drive: FakeDriveState, url: URL): DriveReply => {
  const path = url.pathname.replace(/^\/drive\/v3\//, '');
  if (path === 'changes/startPageToken') {
    return { status: 200, body: { startPageToken: String(drive.position()) } };
  }
  if (path === 'changes') return changes(drive, url);
  if (path === 'files') return listing(drive, url);
  const file = drive.get(decodeURIComponent(path.replace(/^files\//, '')));
  if (file === undefined) return { status: 404, body: { error: { code: 404 } } };
  const download = url.searchParams.get('alt') === 'media';
  if (
    file.refusal !== undefined &&
    (file.refusal.of ?? 'download') === (download ? 'download' : 'metadata')
  ) {
    const { status, reason } = file.refusal;
    return {
      status,
      body: { error: { code: status, message: 'Synthetic refusal.', errors: [{ reason }] } },
    };
  }
  if (download) {
    return { status: 200, bytes: file.bytes ?? new Uint8Array() };
  }
  return { status: 200, body: fileResource(file) };
};
