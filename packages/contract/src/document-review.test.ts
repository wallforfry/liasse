import { describe, expect, it } from 'vitest';
import { documentReviewSchema } from './document-review.ts';

// The review as a server answered it before `type.refusal` and `rejections` existed.
const OLDER_REVIEW = {
  threshold: 0.7,
  reasons: ['rejected_values'],
  rejected_values: 2,
  type: { confidence: 0.9, outcome: 'existing', manual: false, doubtful: false },
  values: [],
};

describe('the review of a document', () => {
  it('reads the review of an older server, without a refusal or the rejected values', () => {
    expect(documentReviewSchema.parse(OLDER_REVIEW)).toMatchObject({
      rejections: [],
      type: { refusal: null },
    });
  });
});
