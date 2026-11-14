import type { Config } from '../../config/schema.ts';
import { endpointHost, endpointLocality, type HostLookup } from './locality.ts';
import type { ModelProvider } from './registry.ts';

export interface ModelPrivacy {
  // Whether each kind of content is sent outside this machine and its private network.
  readonly external: {
    readonly text: boolean;
    readonly vision: boolean;
    readonly embeddings: boolean;
  };
  // The hosts of self-hosted endpoints whose name did not resolve at startup. Such an
  // endpoint counts as external until the process restarts, even on a private network.
  readonly unresolvedHosts: readonly string[];
  // One line for the operator, present when at least one kind of content is external.
  readonly warning: string | undefined;
}

interface Destination {
  readonly label: string;
  readonly unresolvedHost: string | undefined;
}

// `undefined` for an endpoint that keeps the content local.
const externalDestination = async (
  provider: ModelProvider,
  baseUrl: string | undefined,
  lookup: HostLookup | undefined,
): Promise<Destination | undefined> => {
  const locality = await endpointLocality(provider, baseUrl, lookup);
  if (locality === 'local') return undefined;
  const host = endpointHost(provider, baseUrl);
  if (host === undefined) return { label: provider, unresolvedHost: undefined };
  return locality === 'unresolved'
    ? {
        label: `${provider} at ${host} (the name did not resolve, so the endpoint is treated as external)`,
        unresolvedHost: host,
      }
    : { label: `${provider} at ${host}`, unresolvedHost: undefined };
};

// Resolves the hosts of the endpoints, so the verdict is the one the embedder reaches.
export const describeModelPrivacy = async (
  { llm, embedding }: Pick<Config, 'llm' | 'embedding'>,
  lookup?: HostLookup,
): Promise<ModelPrivacy> => {
  const llmDestination = await externalDestination(llm.provider, llm.baseUrl, lookup);
  const embeddingDestination =
    embedding.provider === 'local'
      ? undefined
      : await externalDestination(embedding.provider, embedding.baseUrl, lookup);
  const flows = [
    ...(llmDestination === undefined
      ? []
      : [`document text and page images are sent to ${llmDestination.label}`]),
    ...(embeddingDestination === undefined
      ? []
      : [`text to embed is sent to ${embeddingDestination.label}`]),
  ];
  const unresolvedHosts = [llmDestination, embeddingDestination].flatMap((destination) =>
    destination?.unresolvedHost === undefined ? [] : [destination.unresolvedHost],
  );
  return {
    external: {
      text: llmDestination !== undefined,
      vision: llmDestination !== undefined,
      embeddings: embeddingDestination !== undefined,
    },
    unresolvedHosts: [...new Set(unresolvedHosts)],
    warning:
      flows.length === 0
        ? undefined
        : `Warning: document content leaves this machine: ${flows.join('; ')}. ` +
          'Set LLM_PROVIDER=ollama and EMBEDDING_PROVIDER=local to keep it local.',
  };
};
