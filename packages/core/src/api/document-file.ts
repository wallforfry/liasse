import type { Readable } from 'node:stream';
import { deleteDocument } from '../ingest/delete-document.ts';
import { getDocumentFile } from '../ingest/document-file.ts';
import { StorageObjectNotFoundError } from '../storage/errors.ts';
import type { ApiContext } from './context.ts';
import { ApiError, documentNotFound } from './errors.ts';

export interface OpenedFile {
  readonly mime: string;
  readonly filename: string;
  readonly stream: Readable;
}

/**
 * Opens the original file of a document. Rejects with `document_not_found` for an
 * unknown or deleted document, and with `file_missing` when the storage lost the file:
 * uploading the same bytes again restores it.
 */
export const openDocumentFile = async (
  { db, storage }: Pick<ApiContext, 'db' | 'storage'>,
  id: string,
): Promise<OpenedFile> => {
  const file = await getDocumentFile({ db, storage }, id);
  if (file === undefined) throw documentNotFound();
  try {
    return { mime: file.mime, filename: file.filename, stream: await file.stream() };
  } catch (error) {
    if (!(error instanceof StorageObjectNotFoundError)) throw error;
    throw new ApiError(
      'not_found',
      'file_missing',
      'The file of this document is missing from the storage. Upload it again to restore it.',
    );
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
