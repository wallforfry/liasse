import { mcpResourceOf } from '@liasse/core/auth';
import type { Config } from '@liasse/core/config';
import { describeEmbeddingWindow } from '@liasse/core/embeddings';
import { describeModelPrivacy, type HostLookup } from '@liasse/core/models';
import type { ResolvedSettings } from '@liasse/core/settings';

const LOOPBACK_HOSTS: readonly string[] = ['127.0.0.1', '::1', 'localhost'];
const WILDCARD_HOSTS: readonly string[] = ['0.0.0.0', '::'];

const describeListener = ({ host }: Config['server']): string | undefined =>
  LOOPBACK_HOSTS.includes(host)
    ? undefined
    : `Notice: the server listens on ${host}, beyond this machine. Every route but /health ` +
      'needs an API key, a session of the web UI or a signed file URL; put TLS in front of it.';

// A wildcard address is where the server listens, not where it is reached: the default
// of PUBLIC_URL is then the loopback address, which only this machine can open.
const describePublicUrl = ({ host, port, publicUrl }: Config['server']): string | undefined =>
  WILDCARD_HOSTS.includes(host) && publicUrl === `http://127.0.0.1:${String(port)}`
    ? `Notice: HOST is ${host} and PUBLIC_URL is not set: signed file URLs start with ` +
      `${publicUrl}. Set PUBLIC_URL to the origin clients reach the server at.`
    : undefined;

// OAuth 2.1 needs https, but on the loopback: on plain http elsewhere, MCP over HTTP
// takes API keys only.
const describeMcpOAuth = ({ publicUrl }: Config['server']): string | undefined =>
  mcpResourceOf(publicUrl) === undefined
    ? `Notice: PUBLIC_URL is ${publicUrl}, plain http beyond this machine: MCP over HTTP ` +
      'accepts API keys only, and no OAuth client can connect. Serve it on https.'
    : undefined;

const describeOptionalParts = (
  { resources }: Config,
  { hindsight }: Pick<ResolvedSettings, 'hindsight'>,
): string =>
  'Optional parts: ' +
  [
    `watched folder ${resources.watchDir === undefined ? 'off' : 'on'}`,
    `Hindsight ${hindsight === undefined ? 'off' : 'configured'}`,
  ].join(', ') +
  '.';

/**
 * What the operator is told before anything starts, one line each: who can reach the
 * listener and where signed URLs point. No line holds a secret or a rejected value.
 */
export const startupNotices = (config: Config): readonly string[] =>
  [
    describeListener(config.server),
    describePublicUrl(config.server),
    describeMcpOAuth(config.server),
  ].filter((line) => line !== undefined);

/**
 * What the operator is told each time settings are put in force: where document content
 * goes, how chunks are sized, what is enabled.
 */
export const settingsNotices = async (
  config: Config,
  settings: ResolvedSettings,
  lookup?: HostLookup,
): Promise<readonly string[]> => {
  // The warning names a self-hosted endpoint whose name did not resolve: it counts as
  // external until the settings apply again.
  const { warning } = await describeModelPrivacy(settings, lookup);
  return [
    warning,
    describeEmbeddingWindow(settings.embedding),
    describeOptionalParts(config, settings),
  ].filter((line) => line !== undefined);
};

/** Said at startup while no settings are saved. */
export const UNCONFIGURED_NOTICE =
  'Notice: Liasse has no settings yet. It processes no document until they are saved: sign ' +
  'in to the web UI, then save them with PUT /settings.';
