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

/**
 * The sync lost the lock of its document, with the connection that held it, while a
 * request may have reached Hindsight: what it did is recorded as unknown, and the queue
 * tries again, which forgets or retains as the document now asks.
 */
export class HindsightSyncLockLostError extends Error {
  override readonly name = 'HindsightSyncLockLostError';

  constructor() {
    super('The Hindsight sync lost the lock of the document');
  }
}

/**
 * The forget went through, but a retain of the document whose sync lost its lock, or
 * gave up waiting for an answer, may still reach Hindsight for `retainingMs`. The record
 * that the bank may hold facts stays until then; the queue forgets again after it.
 */
export class HindsightRetainInFlightError extends Error {
  override readonly name = 'HindsightRetainInFlightError';
  readonly retainingMs: number;

  constructor(retainingMs: number) {
    super('A retain of the document may still reach Hindsight');
    this.retainingMs = retainingMs;
  }
}

export class HindsightUrlError extends StartupError {
  override readonly name = 'HindsightUrlError';

  constructor() {
    super(
      'The URL of Hindsight must be an http or https URL without credentials, query string or ' +
        'fragment',
    );
  }
}
