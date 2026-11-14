import { defineConfig } from 'vitest/config';
import { sourceResolution } from '../../vitest.shared.ts';

// Tests that download and run a real model. They are kept out of `pnpm test`, which must
// stay offline and fast, and run with `pnpm test:models`.
export default defineConfig({
  ...sourceResolution,
  test: {
    name: 'core-models',
    root: import.meta.dirname,
    include: ['src/**/*.modeltest.ts'],
    testTimeout: 300_000,
  },
});
