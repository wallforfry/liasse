import { batchesOf } from '../models/batching.ts';
import type { Embedder, Embedding, EmbeddingKind } from '../models/ports.ts';
import { EmbeddingModelDimensionError, EmbeddingOutputError } from './errors.ts';
import { createIdleResource, type ScheduleTimer } from './idle-resource.ts';
import { type LocalModel, type LocalModelLoader, loadTransformersModel } from './local-model.ts';

export const DEFAULT_LOCAL_EMBEDDING_MODEL = 'Xenova/multilingual-e5-small';
export const LOCAL_EMBEDDER_IDLE_MS = 10 * 60 * 1000;

const DEFAULT_BATCH_SIZE = 16;

// Dimensions known without loading the model, so a wrong EMBEDDING_DIM stops the process
// at startup instead of at the first document.
const KNOWN_DIMENSIONS: ReadonlyMap<string, number> = new Map([
  [DEFAULT_LOCAL_EMBEDDING_MODEL, 384],
]);

// The e5 family is trained with these prefixes and loses accuracy without them.
const E5_PREFIXES: Readonly<Record<EmbeddingKind, string>> = {
  query: 'query: ',
  passage: 'passage: ',
};

export interface LocalEmbedderOptions {
  readonly dimension: number;
  readonly cacheDir: string;
  readonly model?: string | undefined;
  readonly idleMs?: number;
  readonly batchSize?: number;
  readonly loadModel?: LocalModelLoader;
  readonly schedule?: ScheduleTimer;
  readonly onUnloadError?: (error: unknown) => void;
}

export interface LocalEmbedder extends Embedder {
  readonly close: () => Promise<void>;
}

const reportUnloadError = (error: unknown): void => {
  const reason = error instanceof Error ? error.message : String(error);
  process.stderr.write(`The local embedding model could not be unloaded: ${reason}\n`);
};

interface OutputContract {
  readonly model: string;
  readonly dimension: number;
}

const normalise = (vector: readonly number[], { model, dimension }: OutputContract): Embedding => {
  if (vector.length !== dimension) {
    throw new EmbeddingModelDimensionError(model, vector.length, dimension);
  }
  const length = Math.hypot(...vector);
  if (!Number.isFinite(length) || length === 0) {
    throw new EmbeddingOutputError(model, 'a vector has no direction');
  }
  return vector.map((value) => value / length);
};

const embedBatch = async (
  loaded: LocalModel,
  texts: readonly string[],
  contract: OutputContract,
): Promise<readonly Embedding[]> => {
  const vectors = await loaded.embed(texts);
  if (vectors.length !== texts.length) {
    throw new EmbeddingOutputError(
      contract.model,
      `${String(vectors.length)} vectors for ${String(texts.length)} texts`,
    );
  }
  return vectors.map((vector) => normalise(vector, contract));
};

export const createLocalEmbedder = ({
  dimension,
  cacheDir,
  model = DEFAULT_LOCAL_EMBEDDING_MODEL,
  idleMs = LOCAL_EMBEDDER_IDLE_MS,
  batchSize = DEFAULT_BATCH_SIZE,
  loadModel = loadTransformersModel,
  schedule,
  onUnloadError = reportUnloadError,
}: LocalEmbedderOptions): LocalEmbedder => {
  const knownDimension = KNOWN_DIMENSIONS.get(model);
  if (knownDimension !== undefined && knownDimension !== dimension) {
    throw new EmbeddingModelDimensionError(model, knownDimension, dimension);
  }
  const contract: OutputContract = { model, dimension };
  const resource = createIdleResource<LocalModel>({
    load: () => loadModel({ model, cacheDir }),
    dispose: (loaded) => loaded.dispose(),
    idleMs,
    onUnloadError,
    ...(schedule === undefined ? {} : { schedule }),
  });

  return {
    dimension,
    model,
    isLocal: true,
    embed: async (texts, kind) => {
      if (texts.length === 0) return [];
      const inputs = texts.map((text) => `${E5_PREFIXES[kind]}${text}`);
      return resource.use(async (loaded) => {
        const embeddings: Embedding[] = [];
        for (const batch of batchesOf(inputs, batchSize)) {
          embeddings.push(...(await embedBatch(loaded, batch, contract)));
        }
        return embeddings;
      });
    },
    close: resource.unload,
  };
};
