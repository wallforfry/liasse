import { z } from 'zod';
import { ModelOutputError } from '../models/errors.ts';
import type { GenerateObjectRequest, TextModel } from '../models/ports.ts';

export type FakeTextRequest = GenerateObjectRequest<unknown>;
export type FakeTextHandler = (request: FakeTextRequest) => unknown;
export type FakeTextScript = readonly unknown[] | FakeTextHandler;

export interface FakeTextModel extends TextModel {
  readonly calls: readonly FakeTextRequest[];
}

export const createFakeTextModel = (
  script: FakeTextScript,
  model = 'fake-text-model',
): FakeTextModel => {
  // A scripted model is a queue by nature: it records calls and consumes responses.
  const calls: FakeTextRequest[] = [];
  const nextResponse = (request: FakeTextRequest): unknown => {
    if (typeof script === 'function') return script(request);
    if (calls.length > script.length) {
      throw new Error(`FakeTextModel has no scripted response for call ${String(calls.length)}`);
    }
    return script[calls.length - 1];
  };
  return {
    calls,
    generateObject: async (request) => {
      request.signal?.throwIfAborted();
      calls.push(request);
      const parsed = request.schema.safeParse(await nextResponse(request));
      if (!parsed.success) {
        throw new ModelOutputError(model, z.prettifyError(parsed.error), { cause: parsed.error });
      }
      return { object: parsed.data, model };
    },
  };
};
