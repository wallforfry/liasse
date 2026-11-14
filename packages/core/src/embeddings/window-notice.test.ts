import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config/load.ts';
import { SYNTHETIC_ENV } from '../testing/synthetic-env.ts';
import { describeEmbeddingWindow } from './window-notice.ts';

const noticeOf = (env: Readonly<Record<string, string>>) =>
  describeEmbeddingWindow(loadConfig({ ...SYNTHETIC_ENV, ...env }).embedding);

const REMOTE = { EMBEDDING_PROVIDER: 'ollama', EMBEDDING_MODEL: 'embedding-model' };

describe('describeEmbeddingWindow', () => {
  it('has nothing to say about the local model, which states its own window', () => {
    expect(noticeOf({})).toBeUndefined();
  });

  it('has nothing to say when the window of the remote model is configured', () => {
    expect(noticeOf({ ...REMOTE, EMBEDDING_MAX_INPUT_TOKENS: '512' })).toBeUndefined();
  });

  it('says that chunks assume an 800-token window when none is configured', () => {
    expect(noticeOf(REMOTE)).toBe(
      'Notice: EMBEDDING_MAX_INPUT_TOKENS is not set, so chunks are sized for an embedding ' +
        'model that reads at least 800 tokens. If embedding-model reads fewer, the end of each ' +
        'chunk is left out of its embedding without an error: set EMBEDDING_MAX_INPUT_TOKENS ' +
        'to the input window of the model.',
    );
  });
});
