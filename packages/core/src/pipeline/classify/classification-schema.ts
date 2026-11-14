import { z } from 'zod';

const confidence = z.number().min(0).max(1);

// The definitions are read as loosely as JSON allows: `createType` validates them and
// answers with an error written for the model, which a refused output could not carry.
const newTypeSchema = z.object({
  slug: z.string(),
  description: z.string(),
  parent_slug: z.string().nullable().optional(),
  fields: z.record(z.string(), z.looseObject({ type: z.string() })),
});

const newDecisionSchema = z.object({
  decision: z.literal('new'),
  new_type: newTypeSchema,
  confidence,
  justification: z.string(),
});
export type NewTypeDecision = z.output<typeof newDecisionSchema>;

export interface ExistingTypeDecision {
  readonly decision: 'existing';
  readonly slug: string;
  readonly confidence: number;
}

export type Classification = ExistingTypeDecision | NewTypeDecision;

/**
 * What the classification call must return. `existing` can only name one of the slugs
 * offered: with none to offer, a new type is the only answer the schema has.
 */
export const classificationSchema = (
  offeredSlugs: readonly string[],
): z.ZodType<Classification> => {
  const [first, ...rest] = offeredSlugs;
  if (first === undefined) return newDecisionSchema;
  return z.discriminatedUnion('decision', [
    z.object({ decision: z.literal('existing'), slug: z.enum([first, ...rest]), confidence }),
    newDecisionSchema,
  ]);
};
