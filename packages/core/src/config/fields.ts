import { z } from 'zod';
import { parseDuration } from './duration.ts';

export const text = z.string().trim().min(1);

export const integer = (min: number, max: number) => z.coerce.number().int().min(min).max(max);

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
