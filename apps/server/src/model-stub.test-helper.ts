import { once } from 'node:events';
import { createServer } from 'node:http';
import { z } from 'zod';
import { LETTER_CLASSIFICATION, LETTER_EXTRACTION } from './synthetic-letter.fixture.ts';

// A local stand-in for a model server, in the wire format of the OpenAI Chat Completions
// and Embeddings APIs that Ollama speaks, so the server process under test reaches no
// provider. It answers for the synthetic letter; classification and extraction are told
// apart by the system prompt, as the fakes of the pipeline tests do.

const chatRequest = z.object({
  messages: z.array(z.object({ role: z.string(), content: z.unknown() })),
});
const embeddingRequest = z.object({ input: z.array(z.string()) });

const isClassification = (body: unknown): boolean =>
  chatRequest
    .parse(body)
    .messages.some(
      ({ role, content }) =>
        role === 'system' && typeof content === 'string' && content.startsWith('You file'),
    );

const chatCompletion = (output: unknown) => ({
  id: 'chatcmpl-synthetic',
  object: 'chat.completion',
  created: 1,
  model: 'text-model',
  choices: [
    {
      index: 0,
      message: { role: 'assistant', content: JSON.stringify(output) },
      finish_reason: 'stop',
    },
  ],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
});

const embeddings = (inputs: readonly string[], dimension: number) => ({
  object: 'list',
  model: 'embedding-model',
  data: inputs.map((_, index) => ({
    object: 'embedding',
    index,
    embedding: Array.from({ length: dimension }, (__, axis) => (axis === 0 ? 1 : 0)),
  })),
  usage: { prompt_tokens: 1, total_tokens: 1 },
});

const answer = (path: string, body: unknown, dimension: number): unknown => {
  if (path.endsWith('/chat/completions')) {
    return chatCompletion(isClassification(body) ? LETTER_CLASSIFICATION : LETTER_EXTRACTION);
  }
  if (path.endsWith('/embeddings')) {
    return embeddings(embeddingRequest.parse(body).input, dimension);
  }
  return undefined;
};

export interface ModelStub {
  readonly url: string;
  readonly paths: readonly string[];
  readonly close: () => Promise<void>;
}

export const startModelStub = async (dimension: number): Promise<ModelStub> => {
  const paths: string[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const path = request.url ?? '';
      paths.push(path);
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const output = answer(path, body, dimension);
      response.writeHead(output === undefined ? 404 : 200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(output ?? { error: { message: 'unknown path' } }));
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no TCP port was assigned');
  return {
    url: `http://127.0.0.1:${String(address.port)}`,
    paths,
    close: async () => {
      server.closeAllConnections();
      server.close();
      await once(server, 'close');
    },
  };
};
