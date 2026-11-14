import { beforeAll, describe, expect, it } from 'vitest';
import { loadQuestions } from '../corpus.ts';
import type { Question } from '../schema/index.ts';
import { describeSlots } from './agent-prompt.ts';
import { agentAnswerSchema, agentStepSchema, toCorpusAnswer } from './agent-schema.ts';
import type { CorpusIds } from './ingest.ts';
import { UNKNOWN_DOCUMENT } from './system-output.ts';

let questions: readonly Question[];

beforeAll(async () => {
  ({ questions } = await loadQuestions());
});

const asked = (id: string): Question => {
  const found = questions.find((question) => question.id === id);
  if (found === undefined) throw new Error(`No question ${id}`);
  return found;
};

const eur = (key: string, value: number) => ({ key, value: { value, currency: 'EUR' } });

describe('the slots shown to the answering agent', () => {
  it('names each key the question has, with its label', () => {
    const shown = describeSlots(asked('q20'));
    asked('q20').expected.counts.forEach(({ key, label }) => {
      expect(shown).toContain(`a count under the key "${key}": ${label}`);
    });
    expect(shown).not.toContain('an amount under');
  });

  it('asks for a verdict only of a yes-or-no question', () => {
    const yesOrNo = questions.find(({ expected }) => expected.verdict !== null);
    const open = questions.find(({ expected }) => expected.verdict === null);
    expect(yesOrNo === undefined ? '' : describeSlots(yesOrNo)).toContain('a verdict');
    expect(open === undefined ? 'a verdict' : describeSlots(open)).not.toContain('a verdict');
  });

  it('refuses a value under a key the question does not have', () => {
    const schema = agentAnswerSchema(asked('q01'));
    const answer = { documents: [], entities: [], counts: [] };
    expect(schema.safeParse({ ...answer, amounts: [eur('total', 597.15)] }).success).toBe(true);
    expect(schema.safeParse({ ...answer, amounts: [eur('sum', 597.15)] }).success).toBe(false);
  });

  it('offers no amount to a question that asks for none', () => {
    const parsed = agentAnswerSchema(asked('q20')).parse({
      documents: [],
      entities: [],
      counts: [],
      amounts: [eur('total', 1)],
    });
    expect(parsed).not.toHaveProperty('amounts');
  });

  it('allows only the answer on the last turn', () => {
    const call = { action: 'call', tool: 'search', arguments: '{}' };
    expect(agentStepSchema(['search'], asked('q01')).safeParse(call).success).toBe(true);
    expect(agentStepSchema([], asked('q01')).safeParse(call).success).toBe(false);
  });
});

describe('toCorpusAnswer', () => {
  const known = new Map([
    ['doc_a', 'lease'],
    ['doc_b', 'rent-receipt-2025-11'],
  ]);
  const ids: CorpusIds = {
    liasseOf: () => undefined,
    corpusOf: (liasseId) => known.get(liasseId),
    duplicateOf: () => null,
  };

  it('names the documents by their corpus id, once each, and an unknown one as such', () => {
    const answer = toCorpusAnswer(
      { documents: ['doc_a', 'doc_b', 'doc_a', 'doc_z'], entities: ['Hector Vasseur'] },
      ids,
    );
    expect(answer).toEqual({
      documents: ['lease', 'rent-receipt-2025-11', UNKNOWN_DOCUMENT],
      amounts: [],
      dates: [],
      counts: [],
      entities: ['Hector Vasseur'],
      verdict: null,
    });
  });
});
