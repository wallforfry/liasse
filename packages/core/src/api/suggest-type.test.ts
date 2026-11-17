import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { ModelOutputError, ModelProviderError } from '../models/errors.ts';
import { ApiError } from './errors.ts';
import type { ApiFeatures } from './features.ts';
import { suggestType } from './suggest-type.ts';

const DRAFT = { slug: 'payslip', description: 'Pay statement', parent_slug: null, fields: {} };

const refusalOf = async (work: Promise<unknown>): Promise<unknown> => {
  try {
    await work;
  } catch (error) {
    return error;
  }
  throw new Error('expected a refusal');
};

const withFeature = (suggest: ApiFeatures['suggestType']) => ({
  features: suggest === undefined ? {} : { suggestType: suggest },
});

describe('suggestType', () => {
  it('hands the trimmed request to the feature', async () => {
    const requests: string[] = [];
    const draft = await suggestType(
      withFeature((request) => {
        requests.push(request);
        return Promise.resolve(DRAFT);
      }),
      { request: '  my payslips  ' },
    );
    expect(draft).toEqual(DRAFT);
    expect(requests).toEqual(['my payslips']);
  });

  it('refuses an empty request', async () => {
    const error = await refusalOf(
      suggestType(
        withFeature(() => Promise.resolve(DRAFT)),
        { request: ' ' },
      ),
    );
    expect(error).toBeInstanceOf(ZodError);
  });

  it('answers not_implemented without the feature', async () => {
    const error = await refusalOf(suggestType(withFeature(undefined), { request: 'payslips' }));
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ kind: 'not_implemented' });
  });

  it.each([
    new ModelProviderError({ provider: 'synthetic', model: 'm', retryable: true }),
    new ModelOutputError('m', 'no object'),
  ])('reports a failing model as unavailable', async (failure) => {
    const error = await refusalOf(
      suggestType(
        withFeature(() => Promise.reject(failure)),
        { request: 'payslips' },
      ),
    );
    expect(error).toMatchObject({ kind: 'unavailable', code: 'model_unavailable' });
  });
});
