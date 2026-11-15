import {
  entityKindSchema,
  isoDateSchema,
  keyDateKindSchema,
  languageCodeSchema,
  moneySchema,
  typeStatusSchema,
} from '@liasse/contract/domain';
import { queryDslSchema } from '@liasse/contract/query';
import { z } from 'zod';
import { keySchema } from './expectation.ts';

const text = z.string().min(1);

// The inputs of the MCP tools a reference question may use, as the specification lists
// them ("MCP contract"). `query` takes the DSL of `@liasse/core/query` itself. The others
// have no schema in the code yet: these follow the specification and give way to the
// schemas of the MCP package once it defines them.
const toolCallSchema = z.discriminatedUnion('tool', [
  z.strictObject({
    tool: z.literal('search'),
    arguments: z.strictObject({
      query: text,
      filters: z
        .strictObject({
          type: text.optional(),
          entity: text.optional(),
          subject: text.optional(),
          from: isoDateSchema.optional(),
          to: isoDateSchema.optional(),
        })
        .optional(),
      limit: z.int().min(1).optional(),
      include_private: z.boolean().optional(),
    }),
  }),
  z.strictObject({ tool: z.literal('query'), arguments: queryDslSchema }),
  z.strictObject({
    tool: z.literal('upcoming'),
    arguments: z.strictObject({
      from: isoDateSchema,
      to: isoDateSchema,
      kinds: z.array(keyDateKindSchema).optional(),
      types: z.array(text).optional(),
      subject: text.optional(),
      current_only: z.boolean().optional(),
    }),
  }),
  z.strictObject({
    tool: z.literal('timeline'),
    arguments: z
      .strictObject({
        subject: text.optional(),
        entity: text.optional(),
        from: isoDateSchema.optional(),
        to: isoDateSchema.optional(),
      })
      .refine(
        ({ subject, entity }) => (subject === undefined) !== (entity === undefined),
        'expected a subject or an entity, not both',
      ),
  }),
  z.strictObject({
    tool: z.literal('recall'),
    arguments: z.strictObject({
      query: text,
      at: isoDateSchema.optional(),
      limit: z.int().min(1).optional(),
    }),
  }),
  z.strictObject({
    tool: z.literal('get_subject'),
    arguments: z
      .strictObject({ id: text.optional(), query: text.optional() })
      .refine(
        ({ id, query }) => (id === undefined) !== (query === undefined),
        'expected an id or a query, not both',
      ),
  }),
  z.strictObject({
    tool: z.literal('list_entities'),
    arguments: z.strictObject({ query: text.optional(), kind: entityKindSchema.optional() }),
  }),
  z.strictObject({
    tool: z.literal('describe_types'),
    arguments: z.strictObject({
      status: typeStatusSchema.optional(),
      include_examples: z.boolean().optional(),
    }),
  }),
]);

export type ToolCall = z.output<typeof toolCallSchema>;
export type ToolName = ToolCall['tool'];

const expectedDocumentsSchema = z.strictObject({
  // Every one of these must be cited.
  required: z.array(keySchema),
  // At least one document of each group must be cited: several documents carry the fact.
  any_of: z.array(z.array(keySchema).min(2)),
  // These may be cited or not: the photo of a paper already required, a side document.
  optional: z.array(keySchema),
  // None of these may be cited: a superseded contract, a private document, a near miss.
  forbidden: z.array(keySchema),
  // True when citing a document outside `required`, `any_of` and `optional` is an error.
  exhaustive: z.boolean(),
});

// A value the answer must give is a slot with a key: the harness asks for each slot by
// its key and label, and the answer files its value under that key. A value is then
// bound to what it measures: the count of one supplier cannot stand for another's, and
// two values under one key contradict each other.
const slot = { key: keySchema, label: text };

const expectedEntitiesSchema = z.strictObject({
  // Entities of the corpus the answer must name.
  required: z.array(keySchema),
  // True when naming anything else is an error: the question asks for an exact set.
  exhaustive: z.boolean(),
});

const hasDistinctKeys = (slots: readonly { readonly key: string }[]): boolean =>
  new Set(slots.map(({ key }) => key)).size === slots.length;

const slots = <Slot extends z.ZodType<{ key: string }>>(schema: Slot) =>
  z.array(schema).refine(hasDistinctKeys, 'expected one slot per key');

export const answerExpectationSchema = z.strictObject({
  documents: expectedDocumentsSchema,
  amounts: slots(z.strictObject({ ...slot, value: moneySchema, tolerance: z.number().min(0) })),
  dates: slots(z.strictObject({ ...slot, date: isoDateSchema })),
  counts: slots(z.strictObject({ ...slot, value: z.int().min(0) })),
  entities: expectedEntitiesSchema,
  // The answer to a yes-or-no question; null when the question is not one.
  verdict: z.boolean().nullable(),
});

export type AnswerExpectation = z.output<typeof answerExpectationSchema>;

export const questionSchema = z.strictObject({
  id: keySchema,
  question: text,
  language: languageCodeSchema,
  // The calls an agent would plausibly make, in order. They document the intended route
  // and are checked against the tool inputs: an agent is free to answer another way.
  tools: z.array(toolCallSchema).min(1),
  expected: answerExpectationSchema,
  rationale: text,
});

export type Question = z.output<typeof questionSchema>;

export const questionSetSchema = z.strictObject({
  // "Today" for every question that speaks of now, this quarter or still.
  reference_date: isoDateSchema,
  questions: z.array(questionSchema),
});

export type QuestionSet = z.output<typeof questionSetSchema>;

// What an agent hands back for one question, with documents named by their corpus id and
// each value under the key of the slot it fills. A value under a key the question does
// not have is not judged.
export const answerSchema = z.strictObject({
  documents: z.array(keySchema),
  amounts: z.array(z.strictObject({ key: keySchema, value: moneySchema })),
  dates: z.array(z.strictObject({ key: keySchema, date: isoDateSchema })),
  counts: z.array(z.strictObject({ key: keySchema, value: z.number() })),
  entities: z.array(z.string()),
  verdict: z.boolean().nullable(),
});

export type Answer = z.output<typeof answerSchema>;
