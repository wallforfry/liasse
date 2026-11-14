import { ModelOutputError } from '../models/errors.ts';

/**
 * Runs one model call of a step. An output that does not match the schema concerns that
 * one item: it is skipped, and the next run asks again. Anything else, a provider that
 * fails or an abort, fails the run, which the queue retries.
 */
export const skippingModelErrors = async <Value>(
  call: () => Promise<Value>,
): Promise<Value | undefined> => {
  try {
    return await call();
  } catch (error) {
    if (error instanceof ModelOutputError) return undefined;
    throw error;
  }
};
