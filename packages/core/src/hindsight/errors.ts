import { StartupError } from '../domain/errors.ts';

export type HindsightOperation = 'retain' | 'forget';

export type HindsightFailureCode = 'timeout' | 'network' | 'aborted' | 'invalid_response';

export interface HindsightFailure {
  readonly operation: HindsightOperation;
  readonly retryable: boolean;
  readonly statusCode?: number | undefined;
  readonly code?: HindsightFailureCode | undefined;
}

// Safe to log by construction: an operation name, a status code and a code from a closed
// list. A Hindsight error body quotes the request (a 422 carries the rejected input), and
// what `fetch` throws can name the URL, so neither is kept and there is no `cause`.
export class HindsightError extends Error {
  override readonly name = 'HindsightError';
  readonly operation: HindsightOperation;
  readonly retryable: boolean;
  readonly statusCode: number | undefined;
  readonly code: HindsightFailureCode | undefined;

  constructor({ operation, retryable, statusCode, code }: HindsightFailure) {
    const details = [
      ...(statusCode === undefined ? [] : [`HTTP ${String(statusCode)}`]),
      ...(code === undefined ? [] : [code]),
    ];
    const suffix = details.length === 0 ? '' : ` (${details.join(', ')})`;
    super(`Hindsight ${operation} failed${suffix}`);
    this.operation = operation;
    this.retryable = retryable;
    this.statusCode = statusCode;
    this.code = code;
  }
}

/** Another sync of the same document is in progress: the queue tries this one again. */
export class HindsightSyncBusyError extends Error {
  override readonly name = 'HindsightSyncBusyError';

  constructor() {
    super('Another Hindsight sync of the document is in progress');
  }
}

export class HindsightUrlError extends StartupError {
  override readonly name = 'HindsightUrlError';

  constructor() {
    super(
      'HINDSIGHT_URL must be an http or https URL without credentials, query string or fragment',
    );
  }
}
