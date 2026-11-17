import { defineProject, mergeConfig } from 'vitest/config';
import { TEST_LIMIT_MILLISECONDS } from './src/test/time-limits.ts';
import viteConfig from './vite.config.ts';

export default mergeConfig(
  viteConfig,
  defineProject({
    test: {
      name: 'web',
      environment: 'jsdom',
      include: ['src/**/*.test.{ts,tsx}'],
      setupFiles: ['./src/test/setup.ts'],
      testTimeout: TEST_LIMIT_MILLISECONDS,
      hookTimeout: TEST_LIMIT_MILLISECONDS,
    },
  }),
);
