import { z } from 'zod';

/** What Liasse reads of a Drive file. Sizes are decimal text on the wire. */
export const driveFileSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  mimeType: z.string(),
  md5Checksum: z.string().optional(),
  size: z.string().regex(/^\d+$/).optional(),
  parents: z.array(z.string()).optional(),
  trashed: z.boolean().optional(),
  shortcutDetails: z
    .object({ targetId: z.string().min(1), targetMimeType: z.string().optional() })
    .optional(),
});
export type DriveFile = z.output<typeof driveFileSchema>;

export const driveChangeSchema = z.object({
  changeType: z.string().optional(),
  fileId: z.string().optional(),
  removed: z.boolean().optional(),
  file: driveFileSchema.optional(),
});
export type DriveChange = z.output<typeof driveChangeSchema>;

export interface DrivePage<Entry> {
  readonly entries: readonly Entry[];
  readonly nextPageToken?: string | undefined;
}

export interface ChangesPage extends DrivePage<DriveChange> {
  /** Given with the last page: where the next listing of changes starts. */
  readonly newStartPageToken?: string | undefined;
}

/** The Drive API v3 calls a Drive source makes, every one read-only. */
export interface DriveApi {
  readonly startPageToken: (signal: AbortSignal) => Promise<string>;
  /** Undefined when Drive knows no file of this id, or this account may not see it. */
  readonly file: (id: string, signal: AbortSignal) => Promise<DriveFile | undefined>;
  /** The children of a folder; trashed ones too when asked, for a folder that left. */
  readonly children: (
    folderId: string,
    page: { readonly pageToken?: string | undefined; readonly withTrashed: boolean },
    signal: AbortSignal,
  ) => Promise<DrivePage<DriveFile>>;
  readonly changes: (pageToken: string, signal: AbortSignal) => Promise<ChangesPage>;
  /**
   * The bytes of a binary file; undefined when Drive knows none of this id. Rejects with
   * `DriveFileRefusedError` when Drive refuses to serve this file in particular.
   */
  readonly download: (
    id: string,
    signal?: AbortSignal,
  ) => Promise<AsyncIterable<Uint8Array> | undefined>;
}

/** Drive refused the access token: the authorization was revoked. */
export class DriveUnauthorizedError extends Error {
  override readonly name = 'DriveUnauthorizedError';
}

/** Drive refuses the bytes of this one file, and would refuse them again. */
export class DriveFileRefusedError extends Error {
  override readonly name = 'DriveFileRefusedError';
}
