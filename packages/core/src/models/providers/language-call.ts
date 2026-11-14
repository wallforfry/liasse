import type { FinishReason, LanguageModel } from 'ai';
import type { Config } from '../../config/schema.ts';
import { ModelOutputError } from '../errors.ts';
import { type CallContext, incompleteReason, resolvedModel, toModelError } from './failure.ts';
import { loadSdk, once, type Sdk } from './lazy.ts';
import { type ProviderOptions, PROVIDERS } from './registry.ts';

export type LlmConfig = Config['llm'];

// The SDK retries a call only after HTTP 408, 409, 429 or 5xx, with an exponential backoff
// that honours `retry-after`.
export const MAX_RETRIES = 2;

export interface LanguageCall extends CallContext {
  readonly timeoutMs: number;
  readonly providerOptions: ProviderOptions;
  readonly loadModel: () => Promise<LanguageModel>;
}

export const languageCall = (config: LlmConfig, modelId: string): LanguageCall => ({
  provider: config.provider,
  model: modelId,
  timeoutMs: config.timeoutMs,
  providerOptions: PROVIDERS[config.provider].generationOptions ?? {},
  loadModel: once(() => PROVIDERS[config.provider].languageModel(config, modelId)),
});

export interface RequestOptions {
  readonly model: LanguageModel;
  readonly temperature: 0;
  readonly maxRetries: number;
  readonly timeout: number;
  readonly providerOptions: ProviderOptions;
  readonly abortSignal?: AbortSignal;
}

export interface Generation<T> {
  readonly finishReason: FinishReason;
  // The model id as the provider reports it, if it does.
  readonly reportedModel: string | undefined;
  readonly value: T;
}

export interface Completion<T> {
  readonly model: string;
  readonly value: T;
}

// Runs one generation and returns its value with the model id the provider resolved.
// Fails with `ModelOutputError` when the output is truncated, refused or absent.
export const runLanguageCall = async <T>(
  call: LanguageCall,
  signal: AbortSignal | undefined,
  generate: (sdk: Sdk, options: RequestOptions) => Promise<Generation<T>>,
): Promise<Completion<T>> => {
  signal?.throwIfAborted();
  const sdk = await loadSdk();
  const languageModel = await call.loadModel();
  const generation = await generate(sdk, {
    model: languageModel,
    // The OpenAI adapter drops the setting for reasoning models, which refuse it, with a
    // warning that is not read here: their output is not reproducible.
    temperature: 0,
    maxRetries: MAX_RETRIES,
    timeout: call.timeoutMs,
    providerOptions: call.providerOptions,
    ...(signal === undefined ? {} : { abortSignal: signal }),
  }).catch((error: unknown) => {
    signal?.throwIfAborted();
    throw toModelError(sdk, error, call);
  });
  const model = resolvedModel(generation.reportedModel, call.model);
  const reason = incompleteReason(generation.finishReason);
  if (reason !== undefined) throw new ModelOutputError(model, reason);
  return { model, value: generation.value };
};
