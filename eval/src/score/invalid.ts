import type { z } from 'zod';

// Problems of an input that is not what a scoring function takes, one per place, as
// "path: message". Bounded: a hostile input may break a schema in thousands of places.
const MAX_REPORTED_ISSUES = 20;
const ROOT = 'input';

export const issuesOf = ({ issues }: z.ZodError): readonly string[] =>
  issues
    .slice(0, MAX_REPORTED_ISSUES)
    .map(({ path, message }) => `${path.length === 0 ? ROOT : path.join('.')}: ${message}`);

// Far deeper than any output or answer a harness builds. Every walk the scoring makes
// (the masking scan, the notes of a judgement) recurses, and a value nested a few
// thousand levels deep exhausts the stack: a deeper input is refused before any walk.
export const MAX_INPUT_DEPTH = 64;

const childrenOf = (value: unknown): readonly unknown[] => {
  if (Array.isArray(value)) return value;
  return typeof value === 'object' && value !== null ? Object.values(value) : [];
};

// Whether the input nests deeper than the limit. Iterative, so that measuring the depth
// is not what overflows the stack; it stops as soon as the limit is crossed.
const isTooDeep = (input: unknown): boolean => {
  const pending: { readonly value: unknown; readonly depth: number }[] = [
    { value: input, depth: 0 },
  ];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (next.depth > MAX_INPUT_DEPTH) return true;
    const depth = next.depth + 1;
    // One at a time: spreading a very wide array into `push` overflows the stack too.
    childrenOf(next.value).forEach((value) => pending.push({ value, depth }));
  }
  return false;
};

// The issue to answer for an input too deep to be scored, or none.
export const depthIssues = (input: unknown): readonly string[] =>
  isTooDeep(input) ? [`${ROOT}: nested deeper than ${String(MAX_INPUT_DEPTH)} levels`] : [];
