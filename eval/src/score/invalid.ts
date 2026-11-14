import type { z } from 'zod';

// Problems of an input that is not what a scoring function takes, one per place, as
// "path: message". Bounded: a hostile input may break a schema in thousands of places.
const MAX_REPORTED_ISSUES = 20;
const ROOT = 'input';

export const issuesOf = ({ issues }: z.ZodError): readonly string[] =>
  issues
    .slice(0, MAX_REPORTED_ISSUES)
    .map(({ path, message }) => `${path.length === 0 ? ROOT : path.join('.')}: ${message}`);
