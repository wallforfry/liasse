import type { Config } from '../../config/schema.ts';
import { endpointHost, isLocalEndpoint } from './locality.ts';
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

export const describeModelPrivacy = ({
  llm,
  embedding,
}: Pick<Config, 'llm' | 'embedding'>): ModelPrivacy => {
  const llmDestination = isLocalEndpoint(llm.provider, llm.baseUrl)
    ? undefined
    : destination(llm.provider, llm.baseUrl);
  const embeddingDestination =
    embedding.provider === 'local' || isLocalEndpoint(embedding.provider, embedding.baseUrl)
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
