import { defineProject } from 'vitest/config';
import { sourceResolution, TEST_FILES } from '../../vitest.shared.ts';

// A database test creates, migrates and drops its own database. That is DDL on a server
// shared with every other test file and session, and its latency is not something the
// test controls: measured at 16 parallel workers, one such cycle takes up to 3.5 s, and
// the default 5 s was hit in 2 runs out of 160 under load. The limit is sized for that.
const DATABASE_TIMEOUT_MILLISECONDS = 30_000;

export default defineProject({
  ...sourceResolution,
  test: {
    name: 'core',
    include: TEST_FILES,
    testTimeout: DATABASE_TIMEOUT_MILLISECONDS,
    hookTimeout: DATABASE_TIMEOUT_MILLISECONDS,
  },
});
