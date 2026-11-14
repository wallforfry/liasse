import { z } from 'zod';

// A query string only carries text. These read the text of one parameter into the value
// the use case expects; the schema of the use case then validates it.

export const flagParam = z.enum(['true', 'false']).transform((value) => value === 'true');

export const integerParam = z
  .string()
  .regex(/^(0|[1-9]\d{0,9})$/, 'expected a decimal integer')
  .transform(Number);

/** `a,b,c`. */
export const listParam = z.string().transform((value) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== ''),
);

// The alphabet of the ids Liasse mints, so nothing else reaches a statement: Postgres
// refuses a NUL character in a parameter. An id of this shape that names nothing is
// answered 404 by the use case.
export const idParam = z.object({ id: z.string().regex(/^[A-Za-z0-9_]{1,64}$/, 'not an id') });
