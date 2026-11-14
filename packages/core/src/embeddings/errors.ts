import { StartupError } from '../domain/errors.ts';

export class EmbeddingModelDimensionError extends StartupError {
  override readonly name = 'EmbeddingModelDimensionError';
  readonly model: string;
  readonly produced: number;
  readonly configured: number;

  constructor(model: string, produced: number, configured: number) {
    super(
      `The embedding model ${model} produces vectors of ${String(produced)} dimensions but ` +
        `EMBEDDING_DIM=${String(configured)}. Set EMBEDDING_DIM=${String(produced)}, or set ` +
        `EMBEDDING_MODEL to a model that produces ${String(configured)} dimensions. The ` +
        'dimension of an installed database is fixed: changing it needs an empty database.',
    );
    this.model = model;
    this.produced = produced;
    this.configured = configured;
  }
}

export class EmbeddingOutputError extends Error {
  override readonly name = 'EmbeddingOutputError';
  readonly model: string;

  constructor(model: string, reason: string) {
    super(`The embedding model ${model} returned an unusable output: ${reason}`);
    this.model = model;
  }
}

// The child process that runs the model ended while a request was in flight, or before it
// could take one. Nothing was lost but the request: the next one starts a new process.
export class LocalModelProcessError extends Error {
  override readonly name: string = 'LocalModelProcessError';
  readonly retryable = true;

  constructor(reason: string) {
    super(`The local embedding model is unavailable, retry: ${reason}`);
  }
}

// The model process stopped answering: it was ended, and the request with it.
export class LocalModelTimeoutError extends LocalModelProcessError {
  override readonly name: string = 'LocalModelTimeoutError';
}

// The embedder was closed, by the shutdown of the server for instance: the request was
// not served and the embedder serves no other. Another process can serve it later, which
// is what `retryable` says; the embedder itself never runs it again.
export class LocalModelClosedError extends LocalModelProcessError {
  override readonly name: string = 'LocalModelClosedError';

  constructor() {
    super('the embedder was closed');
  }
}

// The model process answered that it could not serve the request. `retryable` tells whether
// the same request can succeed later, as after a model download that failed.
export class LocalModelRequestError extends Error {
  override readonly name = 'LocalModelRequestError';
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(`The local embedding model failed: ${message}`);
    this.retryable = retryable;
  }
}

const errorCode = (error: unknown): string =>
  error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : 'unknown error';

export class EmbeddingCacheDirError extends StartupError {
  override readonly name = 'EmbeddingCacheDirError';

  constructor(cause: unknown) {
    super(
      `EMBEDDING_CACHE_DIR cannot be used to store the local embedding model ` +
        `(${errorCode(cause)}): set it to a directory this process can create and write to.`,
      { cause },
    );
  }
}
