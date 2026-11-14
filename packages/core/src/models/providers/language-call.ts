import type { FinishReason, LanguageModel } from 'ai';
import type { Config } from '../../config/schema.ts';
import { ModelOutputError } from '../errors.ts';
import { type CallContext, incompleteReason, toModelError } from './failure.ts';
import { loadSdk, once, type Sdk } from './lazy.ts';
import { endpointSecrets } from './redact.ts';
import { PROVIDERS } from './registry.ts';

export type LlmConfig = Config['llm'];

// The SDK retries a call only after HTTP 408, 409, 429 or 5xx, with an exponential backoff
// that honours `retry-after`.
export const MAX_RETRIES = 2;

export interface LanguageCall extends CallContext {
  readonly loadModel: () => Promise<LanguageModel>;
}

export const languageCall = (config: LlmConfig, modelId: string): LanguageCall => ({
  provider: config.provider,
  model: modelId,
  timeoutMs: config.timeoutMs,
  secrets: endpointSecrets(config),
  loadModel: once(() => PROVIDERS[config.provider].languageModel(config, modelId)),
});

export interface RequestOptions {
  readonly model: LanguageModel;
  readonly temperature: 0;
  readonly maxRetries: number;
  readonly timeout: number;
  readonly abortSignal?: AbortSignal;
}

export interface Completion<T> {
  readonly finishReason: FinishReason;
  readonly model: string;
  readonly value: T;
}

// Runs one generation and returns its value with the model id the provider resolved.
// Fails with `ModelOutputError` when the output is truncated, refused or absent.
export const runLanguageCall = async <T>(
  call: LanguageCall,
  signal: AbortSignal | undefined,
  generate: (sdk: Sdk, options: RequestOptions) => Promise<Completion<T>>,
): Promise<Completion<T>> => {
  signal?.throwIfAborted();
  const sdk = await loadSdk();
  const model = await call.loadModel();
  const completion = await generate(sdk, {
    model,
    temperature: 0,
    maxRetries: MAX_RETRIES,
    timeout: call.timeoutMs,
    ...(signal === undefined ? {} : { abortSignal: signal }),
  }).catch((error: unknown) => {
    signal?.throwIfAborted();
    throw toModelError(sdk, error, call);
  });
  const reason = incompleteReason(completion.finishReason);
  if (reason !== undefined) throw new ModelOutputError(completion.model, reason);
  return completion;
};
