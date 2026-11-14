import { z } from 'zod';

// Messages between the server process and the child process that runs the model.

export const modelRequestSchema = z.object({
  id: z.number().int(),
  kind: z.enum(['embed', 'countTokens']),
  texts: z.array(z.string()),
});
export type ModelRequest = z.infer<typeof modelRequestSchema>;

export const modelResponseSchema = z.discriminatedUnion('outcome', [
  z.object({
    id: z.number().int(),
    outcome: z.literal('vectors'),
    vectors: z.array(z.array(z.number())),
  }),
  z.object({
    id: z.number().int(),
    outcome: z.literal('counts'),
    counts: z.array(z.number().int()),
  }),
  z.object({
    id: z.number().int(),
    outcome: z.literal('failure'),
    message: z.string(),
    retryable: z.boolean(),
  }),
]);
export type ModelResponse = z.infer<typeof modelResponseSchema>;
