import {
  chatCompletion,
  embeddings,
  startStubServer,
  type StubRequest,
  type StubResponse,
  type StubServer,
} from '@liasse/core/testing';
import { z } from 'zod';
import { answerFor } from './synthetic-documents.fixture.ts';

// A local stand-in for a model server, in the wire format of the OpenAI Chat Completions
// and Embeddings APIs that Ollama speaks, so the server process under test reaches no
// provider. It answers for the synthetic letter.

const chatRequest = z.object({
  messages: z.array(z.object({ role: z.string(), content: z.unknown() })),
});
const embeddingRequest = z.object({ input: z.array(z.string()) });

const textOf = (content: unknown): string =>
  typeof content === 'string' ? content : JSON.stringify(content);

const answer =
  (dimension: number) =>
  ({ path, body }: StubRequest): StubResponse => {
    if (path.endsWith('/chat/completions')) {
      const { messages } = chatRequest.parse(body);
      const system = textOf(messages.find(({ role }) => role === 'system')?.content);
      const prompt = messages.map(({ content }) => textOf(content)).join('\n');
      return chatCompletion(JSON.stringify(answerFor(system, prompt)));
    }
    if (path.endsWith('/embeddings')) {
      const unit = Array.from({ length: dimension }, (_, axis) => (axis === 0 ? 1 : 0));
      return embeddings(embeddingRequest.parse(body).input.map(() => unit));
    }
    return { status: 404, body: { error: { message: `no answer for ${path}` } } };
  };

export const startModelStub = (dimension: number): Promise<StubServer> =>
  startStubServer(answer(dimension));
