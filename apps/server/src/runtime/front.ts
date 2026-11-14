import type { ApiContext } from '@liasse/core/api';
import type { Config } from '@liasse/core/config';
import { serveStdio } from '@liasse/mcp';
import { createApp } from '../http/app.ts';
import type { Logger } from '../log.ts';
import { reportMcpFailure } from '../mcp-failures.ts';
import type { ShutdownStep } from '../shutdown.ts';
import { listen } from './listen.ts';

export const TRANSPORTS = ['http', 'stdio'] as const;
export type Transport = (typeof TRANSPORTS)[number];

export interface FrontOptions {
  readonly transport: Transport;
  readonly api: ApiContext;
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

/**
 * The HTTP server (REST, MCP on `/mcp`, the web UI on `/ui`), or MCP on the standard streams. Over stdio
 * nothing listens: the signed file URLs a tool returns open on the HTTP server of
 * `PUBLIC_URL`, when one runs.
 */
export const startFront = async ({
  transport,
  api,
  config,
  ping,
  logger,
  graceMs,
}: FrontOptions): Promise<Front> => {
  if (transport === 'stdio') {
    const session = await serveStdio({ api, report: reportMcpFailure(logger) });
    logger.notice('Liasse is serving MCP on stdio');
    return { stop: { name: 'mcp', run: session.close }, ended: session.ended };
  }
  const { ui } = config.auth;
  const app = createApp({
    api,
    apiTokens: config.auth.apiTokens,
    ping,
    logger,
    ui:
      ui === undefined
        ? undefined
        : {
            password: ui.password,
            sessionTtlMs: ui.sessionTtlMs,
            secureCookies: config.server.publicUrl.startsWith('https:'),
          },
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
