import { once } from 'node:events';
import { type IncomingMessage, Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { StartupError } from '@liasse/core/domain';

export interface ListenOptions {
  readonly fetch: (request: Request) => Response | Promise<Response>;
  readonly host: string;
  readonly port: number;
}

export interface Listener {
  /** The address and port the system bound, read back from the socket. */
  readonly address: string;
  readonly port: number;
  /**
   * Stops accepting connections and lets the requests in progress finish. Those still
   * open after `graceMs` are cut.
   */
  readonly close: (graceMs: number) => Promise<void>;
}

const errorCode = (error: unknown): string =>
  error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : 'unknown error';

const boundOf = (server: Server): AddressInfo => {
  const address: AddressInfo | string | null = server.address();
  if (address === null || typeof address === 'string') throw new Error('The server has no port');
  return address;
};

const close = async (server: Server, graceMs: number): Promise<void> => {
  const closed = once(server, 'close');
  server.close();
  // Connections kept alive between two requests would hold the server open for ever.
  server.closeIdleConnections();
  const cut = setTimeout(() => {
    server.closeAllConnections();
  }, graceMs);
  await closed.finally(() => {
    clearTimeout(cut);
  });
};

// `server.close()` closes only the connections idle at that moment. One busy then is kept
// alive by Node and goes on serving every later request it carries, so the server would
// answer until the grace period cut it. A request received after `close()` is answered
// with `Connection: close`, which ends its connection once the response is sent.
const refuseKeepAliveWhenClosing = (server: Server): void => {
  server.prependListener('request', (_request: IncomingMessage, response: ServerResponse) => {
    if (!server.listening && !response.headersSent) response.setHeader('Connection', 'close');
  });
};

/** Listens on `host` alone: the default is the loopback address, never every interface. */
export const listen = async ({ fetch, host, port }: ListenOptions): Promise<Listener> => {
  const server = serve({ fetch, hostname: host, port });
  // `serve` may also build an HTTP/2 server; it builds this one unless told otherwise.
  if (!(server instanceof Server)) throw new Error('Expected an HTTP/1.1 server');
  refuseKeepAliveWhenClosing(server);
  try {
    await once(server, 'listening');
  } catch (error) {
    throw new StartupError(
      `The server could not listen on ${host}:${String(port)} (${errorCode(error)}): ` +
        'set HOST and PORT to an address this machine has and a port that is free.',
    );
  }
  const { address, port: boundPort } = boundOf(server);
  return { address, port: boundPort, close: (graceMs) => close(server, graceMs) };
};
