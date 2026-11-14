import type { ZodType } from 'zod';

export interface GenerateObjectRequest<T> {
  readonly schema: ZodType<T>;
  readonly system: string;
  readonly prompt: string;
  readonly signal?: AbortSignal;
}

export interface GenerateObjectResult<T> {
  readonly object: T;
  readonly model: string;
}

export interface TextModel {
  readonly generateObject: <T>(
    request: GenerateObjectRequest<T>,
  ) => Promise<GenerateObjectResult<T>>;
}

export interface TranscribePageRequest {
  readonly image: Uint8Array;
  readonly mime: string;
  // The instruction comes from the caller, so an adapter carries no wording of its own.
  readonly prompt: string;
  readonly signal?: AbortSignal;
}

export interface TranscribePageResult {
  readonly markdown: string;
  readonly model: string;
}

export interface VisionModel {
  readonly transcribePage: (request: TranscribePageRequest) => Promise<TranscribePageResult>;
}

export type EmbeddingKind = 'query' | 'passage';

export type Embedding = readonly number[];

export interface Embedder {
  readonly dimension: number;
  readonly model: string;
  readonly isLocal: boolean;
  readonly embed: (texts: readonly string[], kind: EmbeddingKind) => Promise<readonly Embedding[]>;
  // How many tokens of a text given to `embed` the model reads, once its own prefix and
  // special tokens are taken off; what lies beyond is not embedded. Absent when the window
  // is larger than anything Liasse sends.
  readonly maxInputTokens?: number;
  // Tokens of each text for the model's own tokenizer, in the unit of `maxInputTokens`.
  // Absent when the embedder cannot count: callers then estimate.
  readonly countTokens?: (texts: readonly string[]) => Promise<readonly number[]>;
}
