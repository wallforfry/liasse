import type { FinishReason } from 'ai';
import { ModelOutputError, ModelProviderError, OutputSchemaError } from '../errors.ts';
import type { Sdk } from './lazy.ts';
import { identifier, providerErrorCode } from './safe-text.ts';

export interface CallContext {
  readonly provider: string;
  readonly model: string;
}

const INCOMPLETE_REASONS: Partial<Record<FinishReason, string>> = {
  length: 'the output was truncated at the token limit',
  'content-filter': 'the provider refused or filtered the output',
};

// `undefined` for a complete output; otherwise why the output cannot be used.
export const incompleteReason = (finishReason: FinishReason): string | undefined =>
  finishReason === 'stop'
    ? undefined
    : (INCOMPLETE_REASONS[finishReason] ??
      `the model stopped with finish reason "${finishReason}"`);

// The model id the provider reports, or the configured one when it reports none or
// something that is not an identifier.
export const resolvedModel = (reported: unknown, configured: string): string =>
  identifier(reported) ?? configured;

const isTimeout = (error: unknown): boolean =>
  error instanceof Error && error.name === 'TimeoutError';

// Replaces what the SDK throws with errors that hold identifiers only: SDK errors carry
// the request body, the response body and the provider's message.
export const toModelError = (sdk: Sdk, error: unknown, context: CallContext): Error => {
  const { provider, model } = context;
  if (error instanceof OutputSchemaError) return error;
  if (sdk.NoObjectGeneratedError.isInstance(error)) {
    const reason =
      error.finishReason === undefined ? undefined : incompleteReason(error.finishReason);
    return new ModelOutputError(
      resolvedModel(error.response?.modelId, model),
      reason ?? 'the response is not a JSON value',
    );
  }
  if (sdk.NoOutputGeneratedError.isInstance(error)) {
    return new ModelOutputError(model, 'the model returned no output');
  }
  if (isTimeout(error)) {
    return new ModelProviderError({ provider, model, retryable: true, code: 'timeout' });
  }
  const failure = sdk.RetryError.isInstance(error) ? error.lastError : error;
  if (sdk.APICallError.isInstance(failure)) {
    return new ModelProviderError({
      provider,
      model,
      retryable: failure.isRetryable,
      statusCode: failure.statusCode,
      code: providerErrorCode(failure.data),
    });
  }
  return new ModelProviderError({
    provider,
    model,
    retryable: false,
    code: failure instanceof Error ? identifier(failure.name) : undefined,
  });
};
