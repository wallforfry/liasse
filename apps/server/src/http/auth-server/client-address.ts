import { getConnInfo } from '@hono/node-server/conninfo';
import { CLIENT_ADDRESS_HEADER } from '@liasse/core/auth';
import type { ClientAddressResolver } from '@liasse/core/network';
import type { AppContext } from '../env.ts';

// Without a socket (a request handed to `fetch` directly) there is no address, and
// better-auth counts all such requests together.
const socketAddress = (context: AppContext): string | undefined => {
  try {
    return getConnInfo(context).remote.address;
  } catch {
    return undefined;
  }
};

/**
 * The request for the auth server, with the address of the client as the one header
 * better-auth reads it from: the socket address, or what a trusted proxy forwarded (see
 * `TRUSTED_PROXIES`). A copy of that header sent by the client is dropped.
 */
export const withClientAddress = (
  context: AppContext,
  resolveClientAddress: ClientAddressResolver,
): Request => {
  const headers = new Headers(context.req.raw.headers);
  headers.delete(CLIENT_ADDRESS_HEADER);
  const address = resolveClientAddress(socketAddress(context), context.req.raw.headers);
  if (address !== undefined) headers.set(CLIENT_ADDRESS_HEADER, address);
  return new Request(context.req.raw, { headers });
};
