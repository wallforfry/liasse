import { z } from 'zod';

const confidence = z.number().min(0).max(1);

// The definitions are read as loosely as JSON allows: `createType` validates them and
// answers with an error written for the model, which a refused output could not carry.
export const newTypeSchema = z.object({
  slug: z.string(),
  description: z.string(),
  parent_slug: z.string().nullable().optional(),
  fields: z.record(z.string(), z.looseObject({ type: z.string() })),
});
export type NewTypeProposal = z.output<typeof newTypeSchema>;

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

const missing = (ctx: z.RefinementCtx, key: string, decision: string): typeof z.NEVER => {
  ctx.addIssue({ code: 'custom', path: [key], message: `required when decision is "${decision}"` });
  return z.NEVER;
};

// Every provider wants an object at the root of an output schema: OpenAI refuses the
// `oneOf` of a union with `invalid_json_schema`. Both decisions therefore share one
// object, whose members only one of them uses, and the union is rebuilt after parsing.
const eitherDecisionSchema = (offered: readonly [string, ...string[]]) =>
  z
    .object({
      decision: z.enum(['existing', 'new']),
      slug: z.enum(offered).nullish().describe('One of the offered slugs, for "existing".'),
      new_type: newTypeSchema.nullish().describe('The type to create, for "new".'),
      confidence,
      justification: z.string().nullish().describe('Why no offered type fits, for "new".'),
    })
    .transform((output, ctx): Classification => {
      if (output.decision === 'existing') {
        return output.slug == null
          ? missing(ctx, 'slug', 'existing')
          : { decision: 'existing', slug: output.slug, confidence: output.confidence };
      }
      if (output.new_type == null) return missing(ctx, 'new_type', 'new');
      if (output.justification == null) return missing(ctx, 'justification', 'new');
      return {
        decision: 'new',
        new_type: output.new_type,
        confidence: output.confidence,
        justification: output.justification,
      };
    });

/**
 * What the classification call must return. `existing` can only name one of the slugs
 * offered: with none to offer, a new type is the only answer the schema has.
 */
export const classificationSchema = (
  offeredSlugs: readonly string[],
): z.ZodType<Classification> => {
  const [first, ...rest] = offeredSlugs;
  return first === undefined ? newDecisionSchema : eitherDecisionSchema([first, ...rest]);
};
