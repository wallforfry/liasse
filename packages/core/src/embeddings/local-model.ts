import { z } from 'zod';

export interface LocalModelSpec {
  readonly model: string;
  readonly cacheDir: string;
}

// Raw sentence vectors, one per text and in the same order; not normalised.
export interface LocalModel {
  readonly embed: (texts: readonly string[]) => Promise<readonly (readonly number[])[]>;
  readonly dispose: () => Promise<void>;
}

export type LocalModelLoader = (spec: LocalModelSpec) => Promise<LocalModel>;

const vectorsSchema = z.array(z.array(z.number()));

// The import is dynamic so that a process that never embeds never loads ONNX Runtime.
// Transformers.js reads a model file from `cache_dir` when it is there and only goes to the
// network for a file that is missing, so a pre-filled directory needs no network access.
export const loadTransformersModel: LocalModelLoader = async ({ model, cacheDir }) => {
  const { pipeline } = await import('@huggingface/transformers');
  const extractor = await pipeline('feature-extraction', model, {
    dtype: 'q8',
    cache_dir: cacheDir,
  });
  return {
    embed: async (texts) => {
      const output = await extractor([...texts], { pooling: 'mean', normalize: false });
      try {
        return vectorsSchema.parse(output.tolist());
      } finally {
        output.dispose();
      }
    },
    dispose: () => extractor.dispose(),
  };
};
