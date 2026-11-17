import type { EmbeddingSettings } from '../settings/resolve.ts';
import type { Embedder } from '../models/ports.ts';
import {
  createProviderEmbedder,
  type ProviderEmbedderOptions,
} from '../models/providers/embedder.ts';
import { createLocalEmbedder, type LocalEmbedderOptions } from './local.ts';

export interface ConfiguredEmbedder {
  readonly embedder: Embedder;
  // Releases what the embedder holds, such as the process of the local model.
  readonly close: () => Promise<void>;
}

export interface CreateEmbedderOptions extends ProviderEmbedderOptions {
  // How the local embedder runs its model; the child process of the model by default.
  readonly local?: Pick<LocalEmbedderOptions, 'loadModel' | 'idleMs' | 'requestTimeoutMs'>;
}

const unsupported = (config: never): never => {
  throw new Error(`No embedder is implemented for ${JSON.stringify(config)}`);
};

// The one place that turns the embedding provider of the settings into an embedder. Every provider is named: a new
// member of the enumeration does not compile until it has a branch here.
export const createEmbedder = async (
  config: EmbeddingSettings,
  { local, ...options }: CreateEmbedderOptions = {},
): Promise<ConfiguredEmbedder> => {
  switch (config.provider) {
    case 'local': {
      const embedder = createLocalEmbedder({ ...config, ...local });
      return { embedder, close: embedder.close };
    }
    case 'openai':
    case 'mistral':
    case 'gemini':
    case 'ollama':
    case 'openai-compatible':
      return {
        embedder: await createProviderEmbedder(config, options),
        close: () => Promise.resolve(),
      };
    default:
      return unsupported(config);
  }
};
