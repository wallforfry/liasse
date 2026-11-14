import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { ModelProviderError } from '../errors.ts';
import { toModelError } from './failure.ts';
import { loadSdk } from './lazy.ts';

const CONTEXT = { provider: 'ollama', model: 'text-model' };
const ENDPOINT = 'http://user:synthetic-password@gpu-box.example.test:11434/v1/chat/completions';

const withCode = (message: string, code: unknown, cause?: unknown): Error =>
  Object.assign(new Error(message, { cause }), { code });

// What `fetch` throws when it gets no response, as the SDK wraps it.
const unreachable = async (cause: unknown, statusCode?: number): Promise<Error> => {
  const sdk = await loadSdk();
  return toModelError(
    sdk,
    new sdk.APICallError({
      message: `Cannot connect to API: ${ENDPOINT}`,
      url: ENDPOINT,
      requestBodyValues: { prompt: 'synthetic document text' },
      cause,
      isRetryable: true,
      ...(statusCode === undefined ? {} : { statusCode }),
    }),
    CONTEXT,
  );
};

describe('toModelError for a request that got no response', () => {
  it.each([
    ['a refused connection', 'ECONNREFUSED'],
    ['a name that does not resolve', 'ENOTFOUND'],
    ['a resolver that does not answer', 'EAI_AGAIN'],
    ['a closed socket', 'UND_ERR_SOCKET'],
  ])('names %s by the code of its cause', async (_case, code) => {
    const error = await unreachable(withCode(`${code} ${ENDPOINT}`, code));
    expect(error).toBeInstanceOf(ModelProviderError);
    expect(error).toMatchObject({
      code,
      retryable: true,
      statusCode: undefined,
      message: `Provider ollama failed for model text-model (${code})`,
    });
  });

  it('reads the code further down the chain of causes', async () => {
    const error = await unreachable(
      new TypeError('fetch failed', { cause: withCode('connect', 'ECONNREFUSED') }),
    );
    expect(error).toMatchObject({ code: 'ECONNREFUSED' });
  });

  it.each([
    ['no cause', undefined],
    ['a cause without a code', new Error('socket hang up')],
    ['a code that is not a string', withCode('failed', 111)],
    ['a code that is not shaped like a network code', withCode('failed', 'jane.doe@example.test')],
    ['a code in lower case', withCode('failed', 'econnrefused')],
    ['a code longer than a network code', withCode('failed', `E${'X'.repeat(32)}`)],
  ])('falls back to connection_failed for %s', async (_case, cause) => {
    const error = await unreachable(cause);
    expect(error).toMatchObject({
      code: 'connection_failed',
      message: 'Provider ollama failed for model text-model (connection_failed)',
    });
    expect(inspect(error, { depth: Infinity, showHidden: true })).not.toContain('example.test');
  });

  it('skips a code that is not a network code and reads the next cause', async () => {
    const error = await unreachable(
      withCode('outer', 'not a code', withCode('inner', 'ENOTFOUND')),
    );
    expect(error).toMatchObject({ code: 'ENOTFOUND' });
  });

  it('stops reading a chain of causes that loops', async () => {
    const looping = new Error('loop');
    looping.cause = looping;
    expect(await unreachable(looping)).toMatchObject({ code: 'connection_failed' });
  });

  it('keeps nothing of the cause, the URL or the request', async () => {
    const error = await unreachable(withCode(`connect ECONNREFUSED ${ENDPOINT}`, 'ECONNREFUSED'));
    const everything = inspect(error, { depth: Infinity, showHidden: true });
    expect(error).not.toHaveProperty('cause');
    expect(everything).not.toContain('synthetic-password');
    expect(everything).not.toContain('gpu-box');
    expect(everything).not.toContain('synthetic document text');
  });

  it('gives a response without an error body no network code', async () => {
    const error = await unreachable(withCode('ignored', 'ECONNREFUSED'), 502);
    expect(error).toMatchObject({ statusCode: 502, code: undefined });
  });
});
