import { getConnInfo } from '@hono/node-server/conninfo';
import { CLIENT_ADDRESS_HEADER } from '@liasse/core/auth';
import type { AppContext } from '../env.ts';

// The address of the connection, never a forwarded header a client can write. Behind a
// reverse proxy every client is counted as the proxy. Without a socket (a request handed
// to `fetch` directly) there is none, and better-auth counts all such requests together.
const socketAddress = (context: AppContext): string | undefined => {
  try {
    return getConnInfo(context).remote.address;
  } catch {
    return undefined;
  }
};

/**
 * The request for the auth server, with the socket address of the client as the one
 * header better-auth reads it from. A copy of that header sent by the client is dropped.
 */
export const withClientAddress = (context: AppContext): Request => {
  const headers = new Headers(context.req.raw.headers);
  headers.delete(CLIENT_ADDRESS_HEADER);
  const address = socketAddress(context);
  if (address !== undefined) headers.set(CLIENT_ADDRESS_HEADER, address);
  return new Request(context.req.raw, { headers });
};
