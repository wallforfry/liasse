import type { FinishReason } from 'ai';
import { ModelOutputError, ModelProviderError } from '../errors.ts';
import type { Sdk } from './lazy.ts';
import { redact } from './redact.ts';

export interface CallContext {
  readonly provider: string;
  readonly model: string;
  readonly timeoutMs: number;
  readonly secrets: readonly string[];
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

const isTimeout = (error: unknown): boolean =>
  error instanceof Error && error.name === 'TimeoutError';

// Replaces what the SDK throws with errors that are safe to log: no request, no response,
// no header, and a message cleared of the configured credentials.
export const toModelError = (sdk: Sdk, error: unknown, context: CallContext): Error => {
  const { provider, model, timeoutMs, secrets } = context;
  if (sdk.NoObjectGeneratedError.isInstance(error)) {
    const reason =
      error.finishReason === undefined ? undefined : incompleteReason(error.finishReason);
    return new ModelOutputError(
      error.response?.modelId ?? model,
      reason ?? 'the response is not a JSON value',
    );
  }
  if (sdk.NoOutputGeneratedError.isInstance(error)) {
    return new ModelOutputError(model, 'the model returned no output');
  }
  if (isTimeout(error)) {
    return new ModelProviderError({
      provider,
      model,
      retryable: true,
      detail: `no response within ${String(timeoutMs)} ms`,
    });
  }
  const failure = sdk.RetryError.isInstance(error) ? error.lastError : error;
  if (sdk.APICallError.isInstance(failure)) {
    return new ModelProviderError({
      provider,
      model,
      retryable: failure.isRetryable,
      statusCode: failure.statusCode,
      detail: redact(failure.message, secrets),
    });
  }
  return new ModelProviderError({
    provider,
    model,
    retryable: false,
    detail: redact(failure instanceof Error ? failure.message : 'unknown failure', secrets),
  });
};
