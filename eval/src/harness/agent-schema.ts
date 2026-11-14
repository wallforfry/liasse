import { isoDateSchema, moneySchema } from '@liasse/core/domain';
import { z } from 'zod';
import type { Answer, Question } from '../schema/index.ts';
import type { CorpusIds } from './ingest.ts';
import { UNKNOWN_DOCUMENT } from './system-output.ts';

const documentIds = z
  .array(z.string())
  .describe('The ids of the documents the answer rests on, as the tools gave them');
const entityNames = z
  .array(z.string())
  .describe('The organisations and people the answer names, by name');

// Every answer fits this shape; the schema of one question is narrower.
const anyAnswerSchema = z.object({
  documents: documentIds,
  entities: entityNames,
  amounts: z.array(z.object({ key: z.string(), value: moneySchema })).optional(),
  dates: z.array(z.object({ key: z.string(), date: isoDateSchema })).optional(),
  counts: z.array(z.object({ key: z.string(), value: z.number() })).optional(),
  verdict: z.boolean().optional(),
});

/** What the answering agent hands back, with documents named by their Liasse id. */
export type AgentAnswer = z.output<typeof anyAnswerSchema>;

/** Reads a turn the model gave under the schema of one question. */
export const agentStepOutputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('call'), tool: z.string(), arguments: z.string() }),
  z.object({ action: z.literal('answer'), answer: anyAnswerSchema }),
]);

export type AgentStep = z.output<typeof agentStepOutputSchema>;

const keyOf = (slots: readonly { readonly key: string; readonly label: string }[]) => {
  const [first, ...rest] = slots;
  return first === undefined
    ? undefined
    : z
        .enum([first.key, ...rest.map(({ key }) => key)])
        .describe(slots.map(({ key, label }) => `${key}: ${label}`).join('; '));
};

/**
 * The answer one question asks for: the agent is offered the keys of its slots and
 * nothing else, so no value can be filed under a key the question does not have, and a
 * verdict only for a yes-or-no question. Unknown properties are dropped. The model is
 * constrained by it; what it returns is read by `agentStepOutputSchema`.
 */
export const agentAnswerSchema = ({ expected }: Question): z.ZodType => {
  const amountKey = keyOf(expected.amounts);
  const dateKey = keyOf(expected.dates);
  const countKey = keyOf(expected.counts);
  return z.object({
    documents: documentIds,
    entities: entityNames,
    ...(amountKey === undefined
      ? {}
      : { amounts: z.array(z.object({ key: amountKey, value: moneySchema })) }),
    ...(dateKey === undefined
      ? {}
      : { dates: z.array(z.object({ key: dateKey, date: isoDateSchema })) }),
    ...(countKey === undefined
      ? {}
      : { counts: z.array(z.object({ key: countKey, value: z.number() })) }),
    ...(expected.verdict === null ? {} : { verdict: z.boolean() }),
  });
};

/**
 * One turn of the agent: a call to one of the offered tools, or the answer. With no tool
 * offered, on the last turn, the answer is all the schema allows.
 */
export const agentStepSchema = (toolNames: readonly string[], question: Question): z.ZodType => {
  const answer = z.object({ action: z.literal('answer'), answer: agentAnswerSchema(question) });
  const [first, ...rest] = toolNames;
  if (first === undefined) return answer;
  return z.discriminatedUnion('action', [
    z.object({
      action: z.literal('call'),
      tool: z.enum([first, ...rest]),
      arguments: z.string().describe('The arguments of the tool, as one JSON object'),
    }),
    answer,
  ]);
};

/** The answer in the terms of the corpus, as `scoreAnswer` reads it. */
export const toCorpusAnswer = (answer: AgentAnswer, ids: CorpusIds): Answer => ({
  documents: [...new Set(answer.documents.map((id) => ids.corpusOf(id) ?? UNKNOWN_DOCUMENT))],
  amounts: answer.amounts ?? [],
  dates: answer.dates ?? [],
  counts: answer.counts ?? [],
  entities: answer.entities,
  verdict: answer.verdict ?? null,
});
