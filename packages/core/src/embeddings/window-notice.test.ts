import { describe, expect, it } from 'vitest';
import { resolvedSyntheticSettings } from '../testing/synthetic-settings.ts';
import { describeEmbeddingWindow } from './window-notice.ts';

const noticeOf = (embedding: { readonly max_input_tokens?: number } = {}, remote = true) =>
  describeEmbeddingWindow(
    resolvedSyntheticSettings({
      embedding: remote ? { provider: 'ollama', model: 'embedding-model', ...embedding } : {},
    }).embedding,
  );

describe('describeEmbeddingWindow', () => {
  it('has nothing to say about the local model, which states its own window', () => {
    expect(noticeOf({}, false)).toBeUndefined();
  });

  it('has nothing to say when the window of the remote model is configured', () => {
    expect(noticeOf({ max_input_tokens: 512 })).toBeUndefined();
  });

  it('says that chunks assume an 800-token window when none is configured', () => {
    expect(noticeOf()).toBe(
      'Notice: the embedding settings set no max_input_tokens, so chunks are sized for an ' +
        'embedding model that reads at least 800 tokens. If embedding-model reads fewer, the ' +
        'end of each chunk is left out of its embedding without an error: set ' +
        'max_input_tokens to the input window of the model.',
    );
  });
});
