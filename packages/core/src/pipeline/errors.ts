import { DOCUMENT_JOB_FAILURE_CODES } from '@liasse/contract/domain';
import { EntityResolutionContendedError } from '../entities/resolve.ts';
import { PermanentJobError } from '../jobs/errors.ts';
import { ModelOutputError, ModelProviderError } from '../models/errors.ts';
import { StorageObjectNotFoundError } from '../storage/errors.ts';
import { IndexingConflictError } from '../search/indexing.ts';
import { TextExtractionError } from '../text/errors.ts';
import { TextProcessError } from './text-process/extract-in-child.ts';

// What `documents.error` may hold besides the codes of text extraction and of the
// reading process: short, machine-readable, and never a message, which could quote the
// document.
export const PIPELINE_ERROR_CODES = [
  'file_missing',
  'no_text',
  'model_provider_failed',
  'model_output_invalid',
  'processing_conflict',
  'internal_error',
  ...Object.values(DOCUMENT_JOB_FAILURE_CODES),
] as const;
export type PipelineErrorCode = (typeof PIPELINE_ERROR_CODES)[number];

/** A document that cannot be processed, for a reason another attempt would meet again. */
export class DocumentProcessingError extends PermanentJobError {
  override readonly name = 'DocumentProcessingError';
  readonly code: string;

  constructor(code: string, options?: ErrorOptions) {
    super(`The document cannot be processed (${code})`, options);
    this.code = code;
  }
}

// The document, its type or its entities changed during every attempt to write a result
// computed from them. Nothing was written, and a later run can succeed.
export class PipelineConflictError extends Error {
  override readonly name = 'PipelineConflictError';
  readonly retryable = true;

  constructor(documentId: string) {
    super(`Document ${documentId} kept changing while it was processed`);
  }
}

export const documentErrorCode = (error: unknown): string => {
  if (error instanceof DocumentProcessingError) return error.code;
  if (error instanceof TextExtractionError || error instanceof TextProcessError) return error.code;
  if (error instanceof ModelProviderError) return 'model_provider_failed';
  if (error instanceof ModelOutputError) return 'model_output_invalid';
  if (error instanceof StorageObjectNotFoundError) return 'file_missing';
  if (
    error instanceof PipelineConflictError ||
    error instanceof IndexingConflictError ||
    error instanceof EntityResolutionContendedError
  ) {
    return 'processing_conflict';
  }
  return 'internal_error' satisfies PipelineErrorCode;
};

const hasRetryable = (error: unknown): error is { readonly retryable: boolean } =>
  error instanceof TextExtractionError ||
  error instanceof TextProcessError ||
  error instanceof ModelProviderError;

// The retry decision follows the flag each error carries, never its class.
export const isPermanentFailure = (error: unknown): boolean =>
  error instanceof PermanentJobError ||
  error instanceof StorageObjectNotFoundError ||
  (hasRetryable(error) && !error.retryable);
