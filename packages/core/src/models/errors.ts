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
  readonly retryable: boolean;
  readonly statusCode?: number | undefined;
  // A short identifier: the error type and code of the provider (`type:code`), the code of
  // a network failure (`ECONNREFUSED`, `ENOTFOUND`, or `connection_failed` when it has
  // none), `timeout`, or the name of the error class. Never free text.
  readonly code?: string | undefined;
}

// Holds short identifiers only. The free-text message of a provider may quote the request
// (document text, credentials), so it is not kept, and there is no `cause`. Short is a
// bound, not a proof: the provider chooses its model ids and its error codes.
export class ModelProviderError extends Error {
  override readonly name = 'ModelProviderError';
  readonly provider: string;
  readonly model: string;
  readonly retryable: boolean;
  readonly statusCode: number | undefined;
  readonly code: string | undefined;

  constructor({ provider, model, retryable, statusCode, code }: ModelProviderFailure) {
    const details = [
      ...(statusCode === undefined ? [] : [`HTTP ${String(statusCode)}`]),
      ...(code === undefined ? [] : [code]),
    ];
    const suffix = details.length === 0 ? '' : ` (${details.join(', ')})`;
    super(`Provider ${provider} failed for model ${model}${suffix}`);
    this.provider = provider;
    this.model = model;
    this.retryable = retryable;
    this.statusCode = statusCode;
    this.code = code;
  }
}

// A schema that has no JSON Schema form, such as one with `z.date()`: a defect of the
// calling code, not of the provider.
export class OutputSchemaError extends Error {
  override readonly name = 'OutputSchemaError';

  constructor(cause: unknown) {
    const detail = cause instanceof Error ? cause.message : 'unknown reason';
    super(`The output schema cannot be converted to JSON Schema: ${detail}`, { cause });
  }
}

export type ModelListFailure = 'rejected' | 'unreachable' | 'timeout' | 'invalid_answer';

/** The list of the models of a provider could not be read. Identifiers only, as above. */
export class ModelListError extends Error {
  override readonly name = 'ModelListError';
  readonly provider: string;
  readonly failure: ModelListFailure;
  readonly statusCode: number | undefined;
  readonly code: string | undefined;

  constructor(
    provider: string,
    failure: ModelListFailure,
    details: { readonly statusCode?: number | undefined; readonly code?: string | undefined } = {},
  ) {
    super(`Provider ${provider} did not list its models (${failure})`);
    this.provider = provider;
    this.failure = failure;
    this.statusCode = details.statusCode;
    this.code = details.code;
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
