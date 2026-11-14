import { z } from 'zod';

// What the system owes for one value of the ground truth:
// - `required`: the document states it, the system must find it;
// - `optional`: the document states it less plainly, or it is a matter of judgement:
//   finding it is right, missing it is not an error, finding another value is;
// - `forbidden`: the document does not contain it, so any value is an invention.
export const REQUIREMENTS = ['required', 'optional', 'forbidden'] as const;
export type Requirement = (typeof REQUIREMENTS)[number];

export const requirementSchema = z.enum(REQUIREMENTS);

// The words of the document that carry the value, as the pipeline must quote them. Null
// for a value that is derived and written nowhere: a language, a computed deadline.
const quoteSchema = z.string().min(1).nullable();

const stated = <Requirement extends 'required' | 'optional', Value extends z.ZodType>(
  requirement: Requirement,
  value: Value,
) =>
  z.strictObject({
    requirement: z.literal(requirement),
    value,
    quote: quoteSchema,
    // Other values that are just as right: a lease names its landlord and the agency that
    // acts for him, and either is its issuer.
    also: z.array(value).optional(),
  });

export const expectationSchema = <Value extends z.ZodType>(value: Value) =>
  z.discriminatedUnion('requirement', [
    stated('required', value),
    stated('optional', value),
    z.strictObject({ requirement: z.literal('forbidden') }),
  ]);

export type Expectation<Value> =
  | {
      readonly requirement: 'required' | 'optional';
      readonly value: Value;
      readonly quote: string | null;
      readonly also?: Value[] | undefined;
    }
  | { readonly requirement: 'forbidden' };

// Lowercase words joined by hyphens: the ids of documents, entities, subjects and questions.
export const keySchema = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'expected a kebab-case key');
