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
