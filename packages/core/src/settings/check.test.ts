import { decode } from 'jpeg-js';
import { describe, expect, it } from 'vitest';
import { ModelProviderError } from '../models/errors.ts';
import { createFakeEmbedder } from '../testing/fake-embedder.ts';
import { createFakeModelFactories } from '../testing/fake-model-factories.ts';
import { createFakeTextModel } from '../testing/fake-text-model.ts';
import { createFakeVisionModel } from '../testing/fake-vision-model.ts';
import { resolvedSyntheticSettings } from '../testing/synthetic-settings.ts';
import { checkSettings } from './check.ts';

const KEY = 'synthetic-key-quoted-by-a-provider-77aa';

describe('checkSettings', () => {
  it('tries each part and skips Hindsight while it is off', async () => {
    expect(await checkSettings(createFakeModelFactories(), resolvedSyntheticSettings())).toEqual({
      text_model: { status: 'ok' },
      vision_model: { status: 'ok' },
      embedder: { status: 'ok' },
      hindsight: { status: 'skipped' },
    });
  });

  it('shows the vision model a page a decoder reads', async () => {
    const visionModel = createFakeVisionModel(() => '');
    await checkSettings(
      createFakeModelFactories({ visionModel: () => visionModel }),
      resolvedSyntheticSettings(),
    );
    expect(visionModel.calls.map(({ mime }) => mime)).toEqual(['image/jpeg']);
    const decoded = decode(visionModel.calls[0]?.image ?? new Uint8Array(0), { useTArray: true });
    expect({ width: decoded.width, height: decoded.height }).toEqual({ width: 32, height: 32 });
  });

  it('asks Hindsight once a URL is set', async () => {
    const asked: string[] = [];
    const factories = createFakeModelFactories({
      hindsightProbe: () => ({
        retain: () => Promise.resolve(),
        forget: (id) => {
          asked.push(id);
          return Promise.resolve(false);
        },
        requestWindowMs: 0,
      }),
    });
    const result = await checkSettings(
      factories,
      resolvedSyntheticSettings({ hindsight: { url: 'http://127.0.0.1:8888' } }),
    );
    expect(result.hindsight).toEqual({ status: 'ok' });
    expect(asked).toHaveLength(1);
  });

  it('reports an embedder whose vectors do not have the length of EMBEDDING_DIM', async () => {
    const factories = createFakeModelFactories({
      embedder: () => createFakeEmbedder({ dimension: 768 }),
    });
    expect((await checkSettings(factories, resolvedSyntheticSettings())).embedder).toEqual({
      status: 'failed',
      code: 'dimension_mismatch',
      message: 'The embedder answers vectors of 768 dimensions, and EMBEDDING_DIM is 384.',
    });
  });

  it('reports a failed part without anything the provider said', async () => {
    const leaking = new Error(`invalid key ${KEY}`);
    const factories = createFakeModelFactories({
      textModel: () => ({
        generateObject: () =>
          Promise.reject(
            Object.assign(
              new ModelProviderError({
                provider: 'anthropic',
                model: 'text-model',
                retryable: false,
                statusCode: 401,
                code: 'authentication_error',
              }),
              { cause: leaking },
            ),
          ),
      }),
      visionModel: () => ({ transcribePage: () => Promise.reject(leaking) }),
    });
    const result = await checkSettings(factories, resolvedSyntheticSettings());
    expect(result.text_model).toEqual({
      status: 'failed',
      code: 'provider_error',
      message: 'The provider anthropic failed the call with HTTP 401 (authentication_error).',
    });
    expect(result.vision_model).toEqual({
      status: 'failed',
      code: 'unreachable',
      message: 'The call could not be made (Error).',
    });
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  it('reports a model that answers outside the shape asked for', async () => {
    const factories = createFakeModelFactories({
      textModel: () => createFakeTextModel(() => ({ unexpected: true })),
    });
    expect((await checkSettings(factories, resolvedSyntheticSettings())).text_model).toMatchObject({
      status: 'failed',
      code: 'invalid_output',
    });
  });
});
