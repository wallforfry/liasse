export class ModelOutputError extends Error {
  override readonly name = 'ModelOutputError';
  readonly model: string;

  constructor(model: string, reason: string, options?: ErrorOptions) {
    super(`Model ${model} returned an output that does not match the schema: ${reason}`, options);
    this.model = model;
  }
}

export interface ModelProviderFailure {
  readonly provider: string;
  readonly model: string;
  readonly detail: string;
  readonly retryable: boolean;
  readonly statusCode?: number | undefined;
}

// Carries no `cause`: the provider SDK errors it replaces hold the request headers, the
// request body (document text) and the response body.
export class ModelProviderError extends Error {
  override readonly name = 'ModelProviderError';
  readonly provider: string;
  readonly model: string;
  readonly retryable: boolean;
  readonly statusCode: number | undefined;

  constructor({ provider, model, detail, retryable, statusCode }: ModelProviderFailure) {
    const status = statusCode === undefined ? '' : ` (HTTP ${String(statusCode)})`;
    super(`Provider ${provider} failed for model ${model}${status}: ${detail}`);
    this.provider = provider;
    this.model = model;
    this.retryable = retryable;
    this.statusCode = statusCode;
  }
}

export class EmbeddingDimensionError extends Error {
  override readonly name = 'EmbeddingDimensionError';
  readonly expected: number;
  readonly actual: number;

  constructor(model: string, expected: number, actual: number) {
    super(
      `Embedding model ${model} returned vectors of ${String(actual)} dimensions, but EMBEDDING_DIM is ${String(expected)}. ` +
        `Choose a model that produces ${String(expected)} dimensions, or install a new database with EMBEDDING_DIM=${String(actual)}.`,
    );
    this.expected = expected;
    this.actual = actual;
  }
}
