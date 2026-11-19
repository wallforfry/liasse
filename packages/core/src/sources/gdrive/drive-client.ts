import { Readable } from 'node:stream';
import { z } from 'zod';
import { type DriveApi, driveChangeSchema, driveFileSchema } from './drive-api.ts';
import { refusalOf, refusalReasons } from './drive-refusal.ts';

const REQUEST_TIMEOUT_MS = 30_000;
const PAGE_SIZE = '100';
const FILE_FIELDS =
  'id,name,mimeType,md5Checksum,size,parents,trashed,shortcutDetails(targetId,targetMimeType)';
// Shared drives are left out of every answer unless each call asks for them.
const ALL_DRIVES = { supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' } as const;

const startTokenSchema = z.object({ startPageToken: z.string().min(1) });
const filesPageSchema = z.object({
  files: z.array(driveFileSchema).default([]),
  nextPageToken: z.string().optional(),
});
const changesPageSchema = z.object({
  changes: z.array(driveChangeSchema).default([]),
  nextPageToken: z.string().optional(),
  newStartPageToken: z.string().optional(),
});

export type AccessToken = (signal: AbortSignal) => Promise<string>;

// Ids are letters, digits, `-` and `_`; the quote is escaped all the same.
const quoted = (id: string): string => `'${id.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;

/** The Drive API on `fetch`, every request signed with a fresh access token. */
export const createDriveApi = (base: string, accessToken: AccessToken): DriveApi => {
  const request = async (
    path: string,
    query: Readonly<Record<string, string>>,
    signal: AbortSignal | undefined,
    { perFile }: { readonly perFile: boolean } = { perFile: false },
  ): Promise<Response | undefined> => {
    const url = new URL(`${base}/${path}`);
    url.search = new URLSearchParams(query).toString();
    const authorization = `Bearer ${await accessToken(signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS))}`;
    const response = await fetch(url, {
      headers: { Authorization: authorization },
      ...(signal === undefined ? {} : { signal }),
    });
    if (response.ok) return response;
    if (response.status === 404) {
      await response.body?.cancel();
      return undefined;
    }
    const reasons = await refusalReasons(response);
    throw refusalOf({ status: response.status, call: path.split('/')[0] ?? '', reasons, perFile });
  };
  const json = async <Output>(
    schema: z.ZodType<Output>,
    path: string,
    query: Readonly<Record<string, string>>,
    signal: AbortSignal,
  ): Promise<Output | undefined> => {
    const timed = AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]);
    const response = await request(path, query, timed);
    return response === undefined ? undefined : schema.parse(await response.json());
  };
  const required = <Output>(value: Output | undefined, what: string): Output => {
    if (value === undefined) throw new Error(`Drive knows no ${what}.`);
    return value;
  };
  return {
    startPageToken: async (signal) =>
      required(
        await json(
          startTokenSchema,
          'changes/startPageToken',
          { supportsAllDrives: 'true' },
          signal,
        ),
        'start page token',
      ).startPageToken,
    file: (id, signal) =>
      json(
        driveFileSchema,
        `files/${encodeURIComponent(id)}`,
        { fields: FILE_FIELDS, supportsAllDrives: 'true' },
        signal,
      ),
    children: async (folderId, { pageToken, withTrashed }, signal) => {
      const page = required(
        await json(
          filesPageSchema,
          'files',
          {
            q: `${quoted(folderId)} in parents${withTrashed ? '' : ' and trashed = false'}`,
            fields: `nextPageToken,files(${FILE_FIELDS})`,
            pageSize: PAGE_SIZE,
            ...ALL_DRIVES,
            ...(pageToken === undefined ? {} : { pageToken }),
          },
          signal,
        ),
        'folder listing',
      );
      return { entries: page.files, nextPageToken: page.nextPageToken };
    },
    changes: async (pageToken, signal) => {
      const page = required(
        await json(
          changesPageSchema,
          'changes',
          {
            pageToken,
            fields: `nextPageToken,newStartPageToken,changes(changeType,fileId,removed,file(${FILE_FIELDS}))`,
            pageSize: PAGE_SIZE,
            includeRemoved: 'true',
            ...ALL_DRIVES,
          },
          signal,
        ),
        'listing of changes',
      );
      return {
        entries: page.changes,
        nextPageToken: page.nextPageToken,
        newStartPageToken: page.newStartPageToken,
      };
    },
    download: async (id, signal) => {
      const response = await request(
        `files/${encodeURIComponent(id)}`,
        { alt: 'media', supportsAllDrives: 'true' },
        signal,
        { perFile: true },
      );
      if (response === undefined) return undefined;
      return response.body === null ? Readable.from([]) : Readable.fromWeb(response.body);
    },
  };
};
