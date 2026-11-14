export { type ConfiguredEmbedder, createEmbedder, type CreateEmbedderOptions } from './create.ts';
export {
  EmbeddingCacheDirError,
  EmbeddingModelDimensionError,
  EmbeddingOutputError,
  LocalModelClosedError,
  LocalModelProcessError,
  LocalModelRequestError,
  LocalModelTimeoutError,
} from './errors.ts';
export {
  createLocalEmbedder,
  DEFAULT_LOCAL_EMBEDDING_MODEL,
  LOCAL_EMBEDDER_IDLE_MS,
  type LocalEmbedder,
  type LocalEmbedderOptions,
} from './local.ts';
export type { LocalModel, LocalModelLoader, LocalModelSpec } from './local-model.ts';
export { describeEmbeddingWindow } from './window-notice.ts';
