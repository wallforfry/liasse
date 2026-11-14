import { inspect } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { ModelOutputError, ModelProviderError } from '../errors.ts';
import type { VisionModel } from '../ports.ts';
import { type StubHandler, type StubServer, startStubServer } from './stub-server.ts';
import { createVisionModel } from './vision-model.ts';
import {
  chatCompletion,
  failure,
  llmConfig,
  RESOLVED_MODEL,
  SYNTHETIC_API_KEY,
} from './wire-fixtures.ts';

const INSTRUCTIONS = 'Transcribe the page into Markdown.';
const page = { image: new Uint8Array([1, 2, 3]), mime: 'image/png' };

const servers: StubServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

const start = async (
  handler: StubHandler,
): Promise<{ readonly server: StubServer; readonly model: VisionModel }> => {
  const server = await startStubServer(handler);
  servers.push(server);
  const config = llmConfig({
    LLM_PROVIDER: 'openai-compatible',
    LLM_BASE_URL: `${server.url}/v1`,
    LLM_API_KEY: SYNTHETIC_API_KEY,
  });
  return { server, model: createVisionModel(config, INSTRUCTIONS) };
};

describe('createVisionModel', () => {
  it('returns the transcription with the model id resolved by the provider', async () => {
    const { model } = await start(() => chatCompletion('\n# Invoice 42\n\nTotal: 84.20 EUR\n'));
    expect(await model.transcribePage(page)).toEqual({
      markdown: '# Invoice 42\n\nTotal: 84.20 EUR',
      model: RESOLVED_MODEL,
    });
  });

  it('sends the instructions and the page image to the vision model, at temperature 0', async () => {
    const { server, model } = await start(() => chatCompletion('# Invoice 42'));
    await model.transcribePage({ ...page, mime: 'image/jpeg' });
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]?.body).toEqual({
      model: 'vision-model',
      temperature: 0,
      messages: [
        { role: 'system', content: INSTRUCTIONS },
        {
          role: 'user',
          content: [{ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AQID' } }],
        },
      ],
    });
  });

  it('returns an empty transcription for a page the model finds blank', async () => {
    const { model } = await start(() => chatCompletion('  \n'));
    expect((await model.transcribePage(page)).markdown).toBe('');
  });

  it.each([
    ['truncated', 'length', /truncated/],
    ['refused', 'content_filter', /refused/],
  ])('fails with ModelOutputError when the output is %s', async (_case, finishReason, reason) => {
    const { model } = await start(() => chatCompletion('# Invoice', { finishReason }));
    const failed = model.transcribePage(page);
    await expect(failed).rejects.toBeInstanceOf(ModelOutputError);
    await expect(failed).rejects.toThrow(reason);
  });

  it('keeps the API key out of a provider failure', async () => {
    const { model } = await start(({ headers }) =>
      failure(401, `rejected credentials: ${String(headers.authorization)}`),
    );
    const error: unknown = await model.transcribePage(page).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(ModelProviderError);
    expect(inspect(error, { depth: Infinity, showHidden: true })).not.toContain(SYNTHETIC_API_KEY);
  });

  it('honours an aborted signal', async () => {
    const { server, model } = await start(() => chatCompletion('# Invoice 42'));
    await expect(
      model.transcribePage({ ...page, signal: AbortSignal.abort() }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(server.requests).toHaveLength(0);
  });
});
