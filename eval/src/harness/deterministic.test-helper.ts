import { join } from 'node:path';
import type { Settings } from '@liasse/contract';
import {
  chatCompletion,
  createFakeTextModel,
  embeddings,
  type FakeTextModel,
  startStubServer,
  type StubRequest,
  type StubResponse,
  type StubServer,
  SYNTHETIC_ENV,
  syntheticSettings,
  TEST_EMBEDDING_DIM,
} from '@liasse/core/testing';
import { z } from 'zod';
import { oracleAnswer } from '../score/oracle.test-helper.ts';
import type { CorpusIndex } from '../score/index.ts';
import type { Question } from '../schema/index.ts';
import type { CorpusIds } from './ingest.ts';
import type { Env } from './instance.ts';

// The deterministic mode of the harness: the real server and pipeline, with a local
// stand-in for the model server, so no test reaches a provider. The stand-in speaks the
// wire format of the Chat Completions and Embeddings APIs that Ollama serves, and answers
// every pipeline call with the least a valid output holds: a scan is transcribed as one
// fixed line, every document gets one generic type and no extracted value.

const chatRequest = z.object({
  messages: z.array(z.object({ role: z.string(), content: z.unknown() })),
});
const embeddingRequest = z.object({ input: z.array(z.string()) });

const GENERIC_TYPE = {
  decision: 'new',
  confidence: 0.9,
  justification: 'Every document of the deterministic run gets the one generic type.',
  new_type: {
    slug: 'corpus_document',
    description: 'A document of the evaluation corpus',
    parent_slug: null,
    fields: { reference_number: { type: 'identifier' } },
  },
};

const textOf = (content: unknown): string =>
  typeof content === 'string' ? content : JSON.stringify(content);

const pipelineAnswer = (system: string): unknown => {
  if (system.startsWith('You file')) return GENERIC_TYPE;
  if (system.startsWith('You find the links')) return { links: [] };
  if (system.startsWith('You decide whether')) return { choice: 'none' };
  return { core: {}, fields: {}, extra: {} };
};

const answer = ({ path, body }: StubRequest): StubResponse => {
  if (path.endsWith('/chat/completions')) {
    const { messages } = chatRequest.parse(body);
    if (messages.some(({ content }) => textOf(content).includes('"image_url"'))) {
      return chatCompletion('Page transcribed by the deterministic run.');
    }
    const system = textOf(messages.find(({ role }) => role === 'system')?.content);
    return chatCompletion(JSON.stringify(pipelineAnswer(system)));
  }
  if (path.endsWith('/embeddings')) {
    const unit = Array.from({ length: TEST_EMBEDDING_DIM }, (_, axis) => (axis === 0 ? 1 : 0));
    return embeddings(embeddingRequest.parse(body).input.map(() => unit));
  }
  return { status: 404, body: { error: { message: `no answer for ${path}` } } };
};

export const startModelStub = (): Promise<StubServer> => startStubServer(answer);

/** The environment of a deterministic run: the synthetic one. */
export const deterministicEnv = (folder: string): Env => ({
  ...SYNTHETIC_ENV,
  EMBEDDING_DIM: String(TEST_EMBEDDING_DIM),
  EMBEDDING_CACHE_DIR: join(folder, 'models'),
});

/** The settings of a deterministic run: every model on the stand-in. */
export const deterministicSettings = (stubUrl: string): Settings =>
  syntheticSettings({
    llm: { base_url: stubUrl },
    embedding: { provider: 'ollama', model: 'embedding-model', base_url: stubUrl },
  });

// The agent prompt numbers each call it shows: "Call 1: search {...}".
const callsShown = (prompt: string): number => prompt.match(/^Call \d+: /gm)?.length ?? 0;

/**
 * An answering agent that knows the answers: it makes the reference calls of the
 * question through the MCP tools, then gives the expected answer with the Liasse ids of
 * the documents. A run with it passes every question exactly when the harness wiring
 * (ids, tools, translation, scoring) is right.
 */
export const oracleAgent = (
  questions: readonly Question[],
  index: CorpusIndex,
  ids: CorpusIds,
): FakeTextModel =>
  createFakeTextModel(({ prompt }) => {
    const question = questions.find((candidate) =>
      prompt.includes(`Question: ${candidate.question}\n`),
    );
    if (question === undefined) throw new Error('The prompt asks no reference question');
    const made = callsShown(prompt);
    const next = question.tools[made];
    if (next !== undefined) {
      return { action: 'call', tool: next.tool, arguments: JSON.stringify(next.arguments) };
    }
    const expected = oracleAnswer(question, index);
    return {
      action: 'answer',
      answer: { ...expected, documents: expected.documents.map((id) => ids.liasseOf(id) ?? id) },
    };
  });
