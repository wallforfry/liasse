import type { Config } from '../../config/schema.ts';
import { endpointHost, type HostResolver, isLocalEndpoint } from './locality.ts';
import type { ModelProvider } from './registry.ts';

export interface ModelPrivacy {
  // Whether each kind of content is sent outside this machine and its private network.
  readonly external: {
    readonly text: boolean;
    readonly vision: boolean;
    readonly embeddings: boolean;
  };
  // One line for the operator, present when at least one of them is.
  readonly warning: string | undefined;
}

const destination = (provider: ModelProvider, baseUrl: string | undefined): string => {
  const host = endpointHost(provider, baseUrl);
  return host === undefined ? provider : `${provider} at ${host}`;
};

// Resolves the hosts of the endpoints, so the verdict is the one the embedder reaches.
export const describeModelPrivacy = async (
  { llm, embedding }: Pick<Config, 'llm' | 'embedding'>,
  resolveHost?: HostResolver,
): Promise<ModelPrivacy> => {
  const llmDestination = (await isLocalEndpoint(llm.provider, llm.baseUrl, resolveHost))
    ? undefined
    : destination(llm.provider, llm.baseUrl);
  const embeddingDestination =
    embedding.provider === 'local' ||
    (await isLocalEndpoint(embedding.provider, embedding.baseUrl, resolveHost))
      ? undefined
      : destination(embedding.provider, embedding.baseUrl);
  const flows = [
    ...(llmDestination === undefined
      ? []
      : [`document text and page images are sent to ${llmDestination}`]),
    ...(embeddingDestination === undefined
      ? []
      : [`text to embed is sent to ${embeddingDestination}`]),
  ];
  return {
    external: {
      text: llmDestination !== undefined,
      vision: llmDestination !== undefined,
      embeddings: embeddingDestination !== undefined,
    },
    warning:
      flows.length === 0
        ? undefined
        : `Warning: document content leaves this machine: ${flows.join('; ')}. ` +
          'Set LLM_PROVIDER=ollama and EMBEDDING_PROVIDER=local to keep it local.',
  };
};
