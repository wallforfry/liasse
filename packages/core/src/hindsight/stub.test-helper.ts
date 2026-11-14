import { once } from 'node:events';
import { createServer, type IncomingHttpHeaders, type ServerResponse } from 'node:http';
import { z } from 'zod';

export interface StubCall {
  readonly method: string;
  readonly path: string;
  readonly headers: IncomingHttpHeaders;
  /** The parsed JSON body, undefined when the request has none. */
  readonly body: unknown;
}

export interface StubReply {
  readonly status: number;
  readonly headers?: Readonly<Record<string, string>>;
  /** Sent as JSON, or as it is when it is a string. */
  readonly body: unknown;
  /** True when the stub first takes the request into account, as Hindsight would. */
  readonly applied?: boolean;
}

/**
 * Replaces the answer of the stub for one call: `undefined` lets the stub answer as
 * Hindsight does, `'hang'` leaves the request without a response.
 */
export type StubOverride = (
  call: StubCall,
  index: number,
) => StubReply | 'hang' | undefined | Promise<StubReply | 'hang' | undefined>;

export interface StubOptions {
  readonly apiKey?: string;
  readonly override?: StubOverride;
}

export interface HindsightStub {
  readonly url: string;
  readonly calls: readonly StubCall[];
  /** What the stub retains, as `<bank>/<document id>` to the content of the document. */
  readonly documents: ReadonlyMap<string, string>;
  readonly close: () => Promise<void>;
}

const retainBody = z.object({
  items: z.array(
    z.object({
      content: z.string(),
      document_id: z.string(),
      context: z.string().optional(),
      metadata: z.record(z.string(), z.string()).optional(),
      timestamp: z.string().optional(),
    }),
  ),
});

const BANK_ROUTE = /^\/v1\/default\/banks\/([^/]+)\/(memories|documents\/([^/]+))$/;

// The answers below are the ones Hindsight 1.2.1 gave when the wire format was checked
// against a real server (see the pull request of the integration).
const retain = (documents: Map<string, string>, bank: string, body: unknown): StubReply => {
  const parsed = retainBody.safeParse(body);
  if (!parsed.success) {
    return {
      status: 422,
      body: {
        detail: parsed.error.issues.map(({ path, message }) => ({
          type: 'invalid',
          loc: ['body', ...path],
          msg: message,
          input: body,
        })),
      },
    };
  }
  parsed.data.items.forEach(({ document_id: id, content }) => {
    documents.set(`${bank}/${id}`, content);
  });
  return {
    status: 200,
    body: {
      success: true,
      bank_id: bank,
      items_count: parsed.data.items.length,
      async: false,
      operation_id: null,
      operation_ids: null,
      usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    },
  };
};

const deleteDocument = (documents: Map<string, string>, bank: string, id: string): StubReply =>
  documents.delete(`${bank}/${id}`)
    ? {
        status: 200,
        body: {
          success: true,
          message: `Document '${id}' and 1 associated memory units deleted successfully`,
          document_id: id,
          memory_units_deleted: 1,
        },
      }
    : { status: 404, body: { detail: 'Document not found' } };

const answer = (documents: Map<string, string>, call: StubCall, apiKey?: string): StubReply => {
  if (apiKey !== undefined && call.headers.authorization !== `Bearer ${apiKey}`) {
    return { status: 401, body: { detail: 'Authentication failed: Invalid API key' } };
  }
  const [, encodedBank, resource, encodedId] = BANK_ROUTE.exec(call.path) ?? [];
  if (encodedBank === undefined) return { status: 404, body: { detail: 'Not Found' } };
  const bank = decodeURIComponent(encodedBank);
  if (resource === 'memories' && call.method === 'POST') {
    return retain(documents, bank, call.body);
  }
  if (encodedId !== undefined && call.method === 'DELETE') {
    return deleteDocument(documents, bank, decodeURIComponent(encodedId));
  }
  return { status: 405, body: { detail: 'Method Not Allowed' } };
};

const write = (outgoing: ServerResponse, { status, headers, body }: StubReply): void => {
  outgoing.writeHead(status, { 'content-type': 'application/json', ...headers });
  outgoing.end(typeof body === 'string' ? body : JSON.stringify(body));
};

/** A local HTTP server that speaks the part of the Hindsight API Liasse uses. */
export const startHindsightStub = async ({
  apiKey,
  override,
}: StubOptions = {}): Promise<HindsightStub> => {
  const calls: StubCall[] = [];
  const documents = new Map<string, string>();
  const server = createServer((incoming, outgoing) => {
    const chunks: Buffer[] = [];
    incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
    incoming.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      const body: unknown = text === '' ? undefined : JSON.parse(text);
      const call: StubCall = {
        method: incoming.method ?? '',
        path: incoming.url ?? '',
        headers: incoming.headers,
        body,
      };
      const index = calls.push(call) - 1;
      void Promise.resolve(override?.(call, index)).then((reply) => {
        if (reply === 'hang') return;
        const own = reply === undefined || reply.applied === true;
        const answered = own ? answer(documents, call, apiKey) : undefined;
        write(outgoing, reply ?? answered ?? { status: 500, body: {} });
      });
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no TCP port was assigned');
  return {
    url: `http://127.0.0.1:${String(address.port)}`,
    calls,
    documents,
    close: async () => {
      server.closeAllConnections();
      server.close();
      await once(server, 'close');
    },
  };
};
