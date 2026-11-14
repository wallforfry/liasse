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
}
