import { defineProject } from 'vitest/config';
import { sourceResolution, TEST_FILES } from '../../vitest.shared.ts';

// Each test file creates, migrates and drops its own database on the Postgres server every
// other test file shares: the bound of `packages/core/vitest.config.ts`, for the same reason.
const DATABASE_TIMEOUT_MILLISECONDS = 30_000;

export default defineProject({
  ...sourceResolution,
  test: {
    name: 'mcp',
    include: TEST_FILES,
    testTimeout: DATABASE_TIMEOUT_MILLISECONDS,
    hookTimeout: DATABASE_TIMEOUT_MILLISECONDS,
  },
});
