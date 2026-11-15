import { idSchema } from '@liasse/contract';
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

export const idParam = z.object({ id: idSchema });
