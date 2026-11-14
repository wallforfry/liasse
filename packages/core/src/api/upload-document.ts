import { type UploadResult, uploadResultSchema } from '../contract/documents.ts';
import type { DocumentSource } from '../domain/enums.ts';
import {
  EmptyFileError,
  FileTooLargeError,
  IngestError,
  UnsupportedFormatError,
} from '../ingest/errors.ts';
import { ingestFile } from '../ingest/ingest-file.ts';
import type { FileContent } from '../ingest/read-content.ts';
import type { ApiContext } from './context.ts';
import { ApiError } from './errors.ts';

export type UploadInput = FileContent & {
  readonly filename: string;
  /** `api` for REST, `mcp` for the `ingest` tool. */
  readonly source: Exclude<DocumentSource, 'watch'>;
  readonly hint?: string | undefined;
  readonly private?: boolean | undefined;
};

const toApiError = (error: IngestError): ApiError => {
  if (error instanceof FileTooLargeError) {
    return new ApiError('too_large', 'file_too_large', error.message, {
      max_file_size: error.maxFileSize,
    });
  }
  if (error instanceof UnsupportedFormatError) {
    return new ApiError('unsupported', 'unsupported_format', error.message);
  }
  return new ApiError(
    'invalid',
    error instanceof EmptyFileError ? 'empty_file' : 'invalid_file',
    error.message,
  );
};

/**
 * Hands a file to ingestion. Processing is asynchronous: the document is `received`
 * and its status is read with `getDocument`.
 */
export const uploadDocument = async (
  { db, storage, maxFileSize }: Pick<ApiContext, 'db' | 'storage' | 'maxFileSize'>,
  input: UploadInput,
): Promise<UploadResult> => {
  try {
    const { id, status, duplicate } = await ingestFile({ db, storage, maxFileSize }, input);
    return uploadResultSchema.parse({ id, status, duplicate });
  } catch (error) {
    throw error instanceof IngestError ? toApiError(error) : error;
  }
};
