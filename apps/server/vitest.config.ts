import { defineProject } from 'vitest/config';
import { sourceResolution, TEST_FILES } from '../../vitest.shared.ts';

// The health and process tests wait for the Postgres server shared with every other test
// file and session; under that load they exceeded the default 5 s. Same limit as `core`.
const DATABASE_TIMEOUT_MILLISECONDS = 30_000;

export default defineProject({
  ...sourceResolution,
  test: {
    name: 'server',
    include: TEST_FILES,
    testTimeout: DATABASE_TIMEOUT_MILLISECONDS,
    hookTimeout: DATABASE_TIMEOUT_MILLISECONDS,
  },
});
