import type { Readable } from 'node:stream';
import { deleteDocument } from '../ingest/delete-document.ts';
import {
  getDocumentFile,
  SourceFileChangedError,
  SourceFileUnavailableError,
} from '../ingest/document-file.ts';
import { SourceCredentialsError } from '../sources/connector.ts';
import { StorageObjectNotFoundError } from '../storage/errors.ts';
import type { ApiContext } from './context.ts';
import { ApiError, documentNotFound } from './errors.ts';

export interface OpenedFile {
  readonly mime: string;
  readonly filename: string;
  readonly stream: Readable;
}

const fileError = (error: unknown): ApiError | undefined => {
  if (error instanceof StorageObjectNotFoundError) {
    return new ApiError(
      'file_missing',
      'The file of this document is missing from the storage. Upload it again to restore it.',
    );
  }
  if (error instanceof SourceFileChangedError) {
    return new ApiError(
      'file_changed',
      'The file changed at its source since it was read: the next run of the source ' +
        'reads the new version.',
    );
  }
  if (error instanceof SourceCredentialsError) {
    return new ApiError(
      'source_needs_attention',
      'The source that keeps this file refused its credentials: connect it again.',
    );
  }
  if (error instanceof SourceFileUnavailableError) {
    return new ApiError(
      'file_unavailable',
      'The file of this document is no longer at its source: it was trashed, deleted or ' +
        'moved out of the folder read. Its text and knowledge stay.',
    );
  }
  return undefined;
};

/**
 * Opens the original file of a document, from the storage or through the source that
 * keeps it. Rejects with `document_not_found` for an unknown or deleted document, with
 * `file_missing` when the storage lost the file (uploading the same bytes again restores
 * it), with `file_changed` when the source holds other bytes than those indexed, and
 * with `file_unavailable` when no source holds the file any more, and with
 * `source_needs_attention` when every source that keeps it refused its credentials.
 */
export const openDocumentFile = async (
  { db, storage, sourceFiles }: Pick<ApiContext, 'db' | 'storage' | 'sourceFiles'>,
  id: string,
): Promise<OpenedFile> => {
  const file = await getDocumentFile({ db, storage, sourceFiles }, id);
  if (file === undefined) throw documentNotFound();
  try {
    return { mime: file.mime, filename: file.filename, stream: await file.stream() };
  } catch (error) {
    throw fileError(error) ?? error;
  }
};

/**
 * Deletes a document. Rejects with `document_not_found` when there is none, already
 * deleted included: a deletion sent twice finds nothing the second time, which is the
 * state the caller asked for.
 */
export const removeDocument = async (
  { db, features }: Pick<ApiContext, 'db' | 'features'>,
  id: string,
): Promise<void> => {
  const { onDocumentDeleted } = features;
  const deps = onDocumentDeleted === undefined ? { db } : { db, onDeleted: onDocumentDeleted };
  if (!(await deleteDocument(deps, id))) throw documentNotFound();
};
