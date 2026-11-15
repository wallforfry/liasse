import type { SimilarityThresholds } from './similarity.ts';

// The thresholds the tests of the similarity rule are written against. They differ from
// the defaults, which follow the measure of the default embedder, so that a test also
// shows the rule deciding on the thresholds it is given.
export const RULE_SIMILARITY: SimilarityThresholds = {
  attach: 0.92,
  arbitrate: 0.8,
  candidates: 3,
};
