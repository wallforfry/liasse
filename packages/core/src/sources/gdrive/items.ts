import { createHash } from 'node:crypto';
import { mayBeSupported } from '../../formats/declared.ts';
import { type SourceItem, SourceItemError } from '../connector.ts';
import { type DriveApi, type DriveFile, DriveFileRefusedError } from './drive-api.ts';

export const FOLDER_TYPE = 'application/vnd.google-apps.folder';
export const SHORTCUT_TYPE = 'application/vnd.google-apps.shortcut';
// Docs, Sheets, Slides and the other types of Google's own have no bytes to download, so
// no checksum to compare: they are left out.
const GOOGLE_TYPE_PREFIX = 'application/vnd.google-apps.';

// The checksum Drive listed is compared with the bytes read: a file that changed between
// the listing and the download is read again by the next attempt, never recorded under
// the checksum of other bytes.
async function* checked(
  body: AsyncIterable<Uint8Array>,
  checksum: string,
): AsyncGenerator<Uint8Array> {
  const md5 = createHash('md5');
  for await (const chunk of body) {
    md5.update(chunk);
    yield chunk;
  }
  if (md5.digest('hex') !== checksum) {
    throw new Error('The file changed on Drive while it was read.');
  }
}

const download = async (
  api: DriveApi,
  id: string,
  checksum: string,
  signal: AbortSignal,
): Promise<AsyncIterable<Uint8Array>> => {
  const body = await api.download(id, signal).catch((error: unknown) => {
    if (error instanceof DriveFileRefusedError) {
      throw new SourceItemError(error.message, { cause: error });
    }
    throw error;
  });
  // Its removal is a later change of the listing, which the next changes report.
  if (body === undefined) throw new SourceItemError('The file left Drive before it was read.');
  return checked(body, checksum);
};

/**
 * The item of a Drive file, or undefined for a type of Google's own, which has no bytes,
 * and for a file whose type and name no supported format matches: it is never downloaded.
 */
export const fileItem = (
  api: DriveApi,
  file: DriveFile,
  signal: AbortSignal,
): SourceItem | undefined => {
  if (file.mimeType.startsWith(GOOGLE_TYPE_PREFIX)) return undefined;
  if (!mayBeSupported({ name: file.name, type: file.mimeType })) return undefined;
  const described = {
    externalId: file.id,
    name: file.name,
    ...(file.size === undefined ? {} : { size: Number(file.size) }),
  };
  const checksum = file.md5Checksum;
  if (checksum === undefined) {
    return {
      ...described,
      open: () => Promise.reject(new SourceItemError('Drive gives no checksum for this file.')),
    };
  }
  return {
    ...described,
    reference: { checksum },
    open: () => download(api, file.id, checksum, signal),
  };
};
