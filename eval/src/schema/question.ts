import {
  entityKindSchema,
  isoDateSchema,
  keyDateKindSchema,
  languageCodeSchema,
  moneySchema,
  typeStatusSchema,
} from '@liasse/core/domain';
import { queryDslSchema } from '@liasse/core/query';
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

export const answerExpectationSchema = z.strictObject({
  documents: expectedDocumentsSchema,
  amounts: z.array(
    z.strictObject({ label: text, value: moneySchema, tolerance: z.number().min(0) }),
  ),
  dates: z.array(z.strictObject({ label: text, date: isoDateSchema })),
  counts: z.array(z.strictObject({ label: text, value: z.int().min(0) })),
  // Entities of the corpus the answer must name.
  entities: z.array(keySchema),
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

// What an agent hands back for one question, with documents named by their corpus id.
export const answerSchema = z.strictObject({
  documents: z.array(keySchema),
  amounts: z.array(moneySchema),
  dates: z.array(isoDateSchema),
  counts: z.array(z.number()),
  entities: z.array(z.string()),
  verdict: z.boolean().nullable(),
});

export type Answer = z.output<typeof answerSchema>;
