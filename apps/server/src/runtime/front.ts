import type { ApiContext, SettingsContext } from '@liasse/core/api';
import type { Config } from '@liasse/core/config';
import { StartupError } from '@liasse/core/domain';
import { serveStdio } from '@liasse/mcp';
import { createApp } from '../http/app.ts';
import { loadWebAssets, resolveWebAssetsDirectory } from '../http/ui/web-assets.ts';
import type { Logger } from '../log.ts';
import { startAuth } from './auth.ts';
import { reportMcpFailure } from '../mcp-failures.ts';
import type { ShutdownStep } from '../shutdown.ts';
import { listen } from './listen.ts';

export const TRANSPORTS = ['http', 'stdio'] as const;
export type Transport = (typeof TRANSPORTS)[number];

export interface FrontOptions {
  readonly transport: Transport;
  /** The context of the settings in force, undefined while none are saved. */
  readonly api: () => ApiContext | undefined;
  readonly base: Pick<ApiContext, 'db' | 'storage' | 'fileUrls'>;
  readonly settings: SettingsContext;
  readonly config: Config;
  readonly ping: () => Promise<void>;
  readonly logger: Logger;
  readonly graceMs: number;
}

/** What callers reach the server through. */
export interface Front {
  readonly stop: ShutdownStep;
  /** The address and port the HTTP server listens on, as the system bound them. */
  readonly address?: string;
  readonly port?: number;
  /** Over stdio, resolves once the client is gone. */
  readonly ended?: Promise<void>;
}

const STDIO_UNCONFIGURED =
  'Liasse has no settings yet, and MCP on stdio cannot save them: start the server over ' +
  'HTTP once, sign in to the web UI and save them with PUT /settings.';

/**
 * The HTTP server (REST, MCP on `/mcp`, the web UI on `/ui`), or MCP on the standard
 * streams. Over stdio nothing listens: the signed file URLs a tool returns open on the HTTP
 * server of `PUBLIC_URL`, when one runs, and the settings stay those of the start, since
 * nothing in the process can save others.
 */
export const startFront = async ({
  transport,
  api,
  base,
  settings,
  config,
  ping,
  logger,
  graceMs,
}: FrontOptions): Promise<Front> => {
  if (transport === 'stdio') {
    const current = api();
    if (current === undefined) throw new StartupError(STDIO_UNCONFIGURED);
    const session = await serveStdio({ api: current, report: reportMcpFailure(logger) });
    logger.notice('Liasse is serving MCP on stdio');
    return { stop: { name: 'mcp', run: session.close }, ended: session.ended };
  }
  const assets = await loadWebAssets(resolveWebAssetsDirectory());
  const app = createApp({
    api,
    base,
    settings,
    auth: await startAuth({ db: base.db, config, logger }),
    publicUrl: config.server.publicUrl,
    trustedProxies: config.server.trustedProxies,
    assets,
    ping,
    logger,
  });
  const listener = await listen({
    fetch: app.fetch,
    host: config.server.host,
    port: config.server.port,
  });
  logger.notice(`Liasse is listening on http://${config.server.host}:${String(listener.port)}`);
  return {
    stop: { name: 'http', run: () => listener.close(graceMs) },
    address: listener.address,
    port: listener.port,
  };
};
