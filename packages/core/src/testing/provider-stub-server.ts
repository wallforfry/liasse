import { once } from 'node:events';
import { createServer, type IncomingHttpHeaders } from 'node:http';

export interface StubRequest {
  readonly path: string;
  readonly headers: IncomingHttpHeaders;
  readonly body: unknown;
}

export interface StubResponse {
  readonly status?: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body: unknown;
}

// Returning `undefined` leaves the request without a response, to exercise timeouts.
export type StubHandler = (request: StubRequest, index: number) => StubResponse | undefined;

export interface StubServer {
  readonly url: string;
  readonly requests: readonly StubRequest[];
  readonly close: () => Promise<void>;
}

// A local HTTP server that answers provider API calls in tests: it records each JSON
// request and replies with what the handler returns.
export const startStubServer = async (handler: StubHandler): Promise<StubServer> => {
  const requests: StubRequest[] = [];
  const server = createServer((incoming, outgoing) => {
    const chunks: Buffer[] = [];
    incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
    incoming.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      // A GET, such as the list of the models, has no body.
      const body: unknown = raw === '' ? undefined : JSON.parse(raw);
      const request = { path: incoming.url ?? '', headers: incoming.headers, body };
      const response = handler(request, requests.push(request) - 1);
      if (response === undefined) return;
      outgoing.writeHead(response.status ?? 200, {
        'content-type': 'application/json',
        ...response.headers,
      });
      outgoing.end(JSON.stringify(response.body));
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no TCP port was assigned');
  return {
    url: `http://127.0.0.1:${String(address.port)}`,
    requests,
    close: async () => {
      server.closeAllConnections();
      server.close();
      await once(server, 'close');
    },
  };
};
