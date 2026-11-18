import { once } from 'node:events';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { GoogleClient, GoogleEndpoints } from '../sources/google/oauth.ts';
import { createFakeDriveState, type FakeDriveState } from './fake-drive.ts';
import { driveReply, type DriveReply } from './fake-drive-api.ts';
import { type ConsentChoice, createFakeOAuth } from './fake-oauth.ts';

/**
 * The HTTP contract of Google that Liasse uses, served on a local port: the token and
 * revocation endpoints of OAuth 2.0 and the Drive API v3 calls of a Drive source. No local
 * Drive exists, so tests of the Drive source run against this, never against Google.
 */
export interface FakeGoogle {
  readonly endpoints: GoogleEndpoints;
  /** The client it accepts. */
  readonly client: GoogleClient;
  readonly drive: FakeDriveState;
  /** What the browser would come back with after the consent page at `url`. */
  readonly consent: (url: string, choice?: ConsentChoice) => Record<string, string>;
  /** A refresh token for the read access to Drive, as a completed consent leaves one. */
  readonly grant: () => string;
  readonly revoked: () => readonly string[];
  /** The paths and queries of the Drive API requests, in order. */
  readonly driveRequests: () => readonly string[];
  readonly close: () => Promise<void>;
}

const send = (response: ServerResponse, reply: DriveReply): void => {
  if ('bytes' in reply) {
    response.writeHead(reply.status, { 'content-type': 'application/octet-stream' });
    response.end(Buffer.from(reply.bytes));
    return;
  }
  response.writeHead(reply.status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(reply.body));
};

const readForm = async (request: IncomingMessage): Promise<URLSearchParams> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    if (chunk instanceof Buffer) chunks.push(chunk);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
};

const UNAUTHORIZED = {
  status: 401,
  body: { error: { code: 401, message: 'Invalid Credentials' } },
};

export const startFakeGoogle = async (): Promise<FakeGoogle> => {
  const oauth = createFakeOAuth();
  const drive = createFakeDriveState();
  const driveRequests: string[] = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://fake.test');
    if (request.method === 'POST') {
      void readForm(request).then((form) => {
        if (url.pathname === '/token') send(response, oauth.token(form));
        else if (url.pathname === '/revoke') send(response, oauth.revoke(form));
        else send(response, { status: 404, body: {} });
      });
      return;
    }
    driveRequests.push(`${url.pathname}${url.search}`);
    send(
      response,
      oauth.authorizes(request.headers.authorization) ? driveReply(drive, url) : UNAUTHORIZED,
    );
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no TCP port was assigned');
  const base = `http://127.0.0.1:${String(address.port)}`;
  return {
    endpoints: {
      consent: `${base}/consent`,
      token: `${base}/token`,
      revoke: `${base}/revoke`,
      drive: `${base}/drive/v3`,
    },
    client: oauth.client,
    drive,
    consent: oauth.consent,
    grant: oauth.grant,
    revoked: oauth.revoked,
    driveRequests: () => [...driveRequests],
    close: async () => {
      server.closeAllConnections();
      server.close();
      await once(server, 'close');
    },
  };
};
