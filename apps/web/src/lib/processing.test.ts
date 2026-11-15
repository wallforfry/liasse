import { describe, expect, it } from 'vitest';
import { POLL_MILLISECONDS, pollWhileProcessing } from './processing.ts';

describe('pollWhileProcessing', () => {
  it.each(['received', 'extracted', 'classified'] as const)(
    'polls while a document is %s',
    (status) => {
      expect(pollWhileProcessing([{ status: 'indexed' }, { status }])).toBe(POLL_MILLISECONDS);
    },
  );

  it('stops once every document has settled, and before any is read', () => {
    expect(
      pollWhileProcessing([
        { status: 'indexed' },
        { status: 'needs_review' },
        { status: 'failed' },
      ]),
    ).toBe(false);
    expect(pollWhileProcessing([])).toBe(false);
    expect(pollWhileProcessing(undefined)).toBe(false);
  });
});
