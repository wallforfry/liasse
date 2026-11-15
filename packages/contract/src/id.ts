import { z } from 'zod';

// The alphabet of the ids Liasse mints, so nothing else reaches a statement: Postgres
// refuses a NUL character in a parameter. An id of this shape that names nothing is
// answered `not_found` by the use case.
export const idSchema = z.string().regex(/^[A-Za-z0-9_]{1,64}$/, 'not an id');
