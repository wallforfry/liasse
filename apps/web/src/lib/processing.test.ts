import { describe, expect, it } from 'vitest';
import { POLL_MILLISECONDS, pollDocument, pollWhileProcessing } from './processing.ts';

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

describe('pollDocument', () => {
  it('polls a settled document while a job is about to rewrite it, and stops after', () => {
    expect(pollDocument({ status: 'needs_review', analysis_pending: true })).toBe(
      POLL_MILLISECONDS,
    );
    expect(pollDocument({ status: 'needs_review', analysis_pending: false })).toBe(false);
  });

  it('polls a document on its way, and none before it is read', () => {
    expect(pollDocument({ status: 'classified', analysis_pending: false })).toBe(POLL_MILLISECONDS);
    expect(pollDocument(undefined)).toBe(false);
  });
});
