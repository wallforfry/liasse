import { batchesOf } from '../models/batching.ts';
import type { Embedder, Embedding, EmbeddingKind } from '../models/ports.ts';
import {
  EmbeddingModelDimensionError,
  EmbeddingOutputError,
  LocalModelProcessError,
  LocalModelTimeoutError,
} from './errors.ts';
import { createIdleResource, type ScheduleTimer } from './idle-resource.ts';
import type { LocalModel, LocalModelLoader } from './local-model.ts';
import { loadModelInChildProcess } from './model-process.ts';

export const DEFAULT_LOCAL_EMBEDDING_MODEL = 'Xenova/multilingual-e5-small';
export const LOCAL_EMBEDDER_IDLE_MS = 10 * 60 * 1000;

// Measured on 64 inputs of 512 tokens (Linux arm64, Node 22): the model process peaks at
// 0.83 GB with batches of 4, 1.05 GB with 8 and 1.5 GB with 16, for 9.0, 8.1 and 6.6 seconds.
const DEFAULT_BATCH_SIZE = 4;

// What the e5 family reads, and what the embedder itself puts in it: the two special tokens
// and a prefix of at most four tokens, rounded up.
const E5_WINDOW_TOKENS = 512;
const E5_RESERVED_TOKENS = 8;

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
  readonly requestTimeoutMs?: number;
  readonly loadModel?: LocalModelLoader;
  readonly schedule?: ScheduleTimer;
  readonly onUnloadError?: (error: unknown) => void;
}

export interface LocalEmbedder extends Embedder {
  readonly maxInputTokens: number;
  readonly countTokens: (texts: readonly string[]) => Promise<readonly number[]>;
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
  requestTimeoutMs,
  loadModel = loadModelInChildProcess,
  schedule,
  onUnloadError = reportUnloadError,
}: LocalEmbedderOptions): LocalEmbedder => {
  const knownDimension = KNOWN_DIMENSIONS.get(model);
  if (knownDimension !== undefined && knownDimension !== dimension) {
    throw new EmbeddingModelDimensionError(model, knownDimension, dimension);
  }
  const contract: OutputContract = { model, dimension };
  const resource = createIdleResource<LocalModel>({
    load: () =>
      loadModel({
        model,
        cacheDir,
        ...(requestTimeoutMs === undefined ? {} : { requestTimeoutMs }),
      }),
    dispose: (loaded) => loaded.dispose(),
    idleMs,
    onUnloadError,
    ...(schedule === undefined ? {} : { schedule }),
  });

  // A model process that died is of no further use: it is dropped and the task runs once more
  // on a new one, so that a process lost while idle costs the caller nothing. A process that
  // was ended for not answering is not asked the same thing again.
  const withModel = async <R>(
    task: (loaded: LocalModel) => Promise<R>,
    retried = false,
  ): Promise<R> => {
    try {
      return await resource.use(task);
    } catch (error) {
      if (!(error instanceof LocalModelProcessError)) throw error;
      await resource.unload().catch(onUnloadError);
      if (retried || error instanceof LocalModelTimeoutError) throw error;
      return withModel(task, true);
    }
  };

  return {
    dimension,
    model,
    isLocal: true,
    maxInputTokens: E5_WINDOW_TOKENS - E5_RESERVED_TOKENS,
    countTokens: (texts) =>
      texts.length === 0 ? Promise.resolve([]) : withModel((loaded) => loaded.countTokens(texts)),
    embed: async (texts, kind) => {
      if (texts.length === 0) return [];
      const inputs = texts.map((text) => `${E5_PREFIXES[kind]}${text}`);
      return withModel(async (loaded) => {
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
