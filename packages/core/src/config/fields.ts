import { z } from 'zod';
import { parseDuration } from './duration.ts';

export const text = z.string().trim().min(1);

// `Number()` also reads '0x10', '1e3' and ' ' (as 16, 1000 and 0); only plain decimal
// notation is accepted, so a typo never becomes a silently different value.
export const integer = (min: number, max: number) =>
  z
    .string()
    .regex(/^(0|[1-9]\d*)$/, 'expected a decimal integer such as 42')
    .transform(Number)
    .pipe(z.number().int().min(min).max(max));

export const decimal = (min: number, max: number) =>
  z
    .string()
    .regex(/^(0|[1-9]\d*)(\.\d+)?$/, 'expected a decimal number such as 0.7')
    .transform(Number)
    .pipe(z.number().min(min).max(max));

export const list = z.string().transform((value) =>
  Object.freeze(
    value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item !== ''),
  ),
);

export const duration = z.string().transform((value, ctx) => {
  const milliseconds = parseDuration(value);
  if (milliseconds === undefined) {
    ctx.addIssue({ code: 'custom', message: 'expected a duration such as 30m, 12h or 7d' });
    return z.NEVER;
  }
  return milliseconds;
});

export interface CrossFieldProblem {
  readonly key: string;
  readonly message: string;
}

export const reportProblems = (
  ctx: z.RefinementCtx,
  problems: readonly CrossFieldProblem[],
): void => {
  problems.forEach(({ key, message }) => {
    ctx.addIssue({ code: 'custom', path: [key], message });
  });
};
