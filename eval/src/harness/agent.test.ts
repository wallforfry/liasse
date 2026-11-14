import { createFakeTextModel } from '@liasse/core/testing';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadQuestions } from '../corpus.ts';
import type { Question } from '../schema/index.ts';
import { answerQuestion, MAX_AGENT_TURNS } from './agent.ts';
import type { McpSession } from './mcp-session.ts';

let question: Question;

beforeAll(async () => {
  const { questions } = await loadQuestions();
  const [first] = questions;
  if (first === undefined) throw new Error('No question');
  question = first;
});

interface Called {
  readonly name: string;
  readonly args: Readonly<Record<string, unknown>>;
}

const sessionRecording = (called: Called[]): McpSession => ({
  tools: [{ name: 'search', description: 'Searches the documents', inputSchema: {} }],
  call: (name, args) => {
    called.push({ name, args });
    return Promise.resolve({ isError: false, text: '{"items":[{"id":"doc_1"}]}' });
  },
  close: () => Promise.resolve(),
});

const ANSWER = {
  action: 'answer',
  answer: { documents: ['doc_1'], entities: [], amounts: [], dates: [], counts: [] },
};

describe('answerQuestion', () => {
  it('calls the tools the model asks for, shows it the results, and returns its answer', async () => {
    const called: Called[] = [];
    const model = createFakeTextModel([
      { action: 'call', tool: 'search', arguments: '{"query":"électricité"}' },
      ANSWER,
    ]);
    const run = await answerQuestion(
      { model, session: sessionRecording(called), referenceDate: '2026-01-15' },
      question,
    );
    expect(called).toEqual([{ name: 'search', args: { query: 'électricité' } }]);
    expect(run).toEqual({
      answer: { documents: ['doc_1'], entities: [], amounts: [], counts: [] },
      calls: [{ tool: 'search', arguments: '{"query":"électricité"}', is_error: false }],
      failure: undefined,
    });
    expect(model.calls[1]?.prompt).toContain('Call 1: search {"query":"électricité"}');
    expect(model.calls[1]?.prompt).toContain('"id":"doc_1"');
    expect(model.calls[0]?.system).toContain('Today is 2026-01-15');
    expect(model.calls[0]?.prompt).toContain('an amount under the key "total"');
  });

  it('answers arguments that are not a JSON object with an error, without calling', async () => {
    const called: Called[] = [];
    const model = createFakeTextModel([
      { action: 'call', tool: 'search', arguments: 'query=électricité' },
      ANSWER,
    ]);
    const run = await answerQuestion(
      { model, session: sessionRecording(called), referenceDate: '2026-01-15' },
      question,
    );
    expect(called).toEqual([]);
    expect(run.calls).toEqual([{ tool: 'search', arguments: 'query=électricité', is_error: true }]);
  });

  it('gives no answer, with the reason, when the model fails', async () => {
    const model = createFakeTextModel([{ action: 'guess' }]);
    const run = await answerQuestion(
      { model, session: sessionRecording([]), referenceDate: '2026-01-15' },
      question,
    );
    expect(run.answer).toBeUndefined();
    expect(run.failure).toMatch(/^ModelOutputError: /);
  });

  it('gives no answer when the model only ever calls tools', async () => {
    const model = createFakeTextModel(() => ({ action: 'call', tool: 'search', arguments: '{}' }));
    const run = await answerQuestion(
      { model, session: sessionRecording([]), referenceDate: '2026-01-15' },
      question,
    );
    expect(run.answer).toBeUndefined();
    expect(run.calls).toHaveLength(MAX_AGENT_TURNS - 1);
    expect(run.failure).toMatch(/^ModelOutputError: /);
  });
});
