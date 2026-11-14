import type { Config } from '@liasse/core/config';
import { describeEmbeddingWindow } from '@liasse/core/embeddings';
import { describeModelPrivacy } from '@liasse/core/models';

const LOOPBACK_HOSTS: readonly string[] = ['127.0.0.1', '::1', 'localhost'];
const WILDCARD_HOSTS: readonly string[] = ['0.0.0.0', '::'];

const describeListener = ({ host }: Config['server']): string | undefined =>
  LOOPBACK_HOSTS.includes(host)
    ? undefined
    : `Notice: the server listens on ${host}, beyond this machine. Every route but /health ` +
      'needs a Bearer token or a signed file URL; put TLS in front of it.';

// A wildcard address is where the server listens, not where it is reached: the default
// of PUBLIC_URL is then the loopback address, which only this machine can open.
const describePublicUrl = ({ host, port, publicUrl }: Config['server']): string | undefined =>
  WILDCARD_HOSTS.includes(host) && publicUrl === `http://127.0.0.1:${String(port)}`
    ? `Notice: HOST is ${host} and PUBLIC_URL is not set: signed file URLs start with ` +
      `${publicUrl}. Set PUBLIC_URL to the origin clients reach the server at.`
    : undefined;

const describeOptionalParts = ({ pipeline, hindsight, auth }: Config): string =>
  'Optional parts: ' +
  [
    `watched folder ${pipeline.watchDir === undefined ? 'off' : 'on'}`,
    `Hindsight ${hindsight === undefined ? 'off' : 'configured'}`,
    `web UI ${auth.ui === undefined ? 'off' : 'configured'}`,
  ].join(', ') +
  '.';

/**
 * What the operator is told before anything starts, one line each: where document
 * content goes, how chunks are sized, who can reach the listener, what is enabled.
 * No line holds a secret or a rejected value.
 */
export const startupNotices = async (config: Config): Promise<readonly string[]> => {
  const { warning } = await describeModelPrivacy(config);
  return [
    warning,
    describeEmbeddingWindow(config.embedding),
    describeListener(config.server),
    describePublicUrl(config.server),
    describeOptionalParts(config),
  ].filter((line) => line !== undefined);
};
