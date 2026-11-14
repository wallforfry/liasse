import { defineConfig } from 'vitest/config';
import { sourceResolution } from './vitest.shared.ts';

// Tests of BM25 ranking, which need a Postgres with ParadeDB pg_search: the `paradedb` service
// of docker-compose.dev.yml (`pnpm db:up:paradedb`). They are kept out of `pnpm test`, whose
// server has no pg_search, and run with `pnpm test:paradedb`. The URL is set here, over any
// TEST_DATABASE_URL, so these tests never run against the server of `pnpm test`.
export default defineConfig({
  ...sourceResolution,
  test: {
    name: 'paradedb',
    root: import.meta.dirname,
    include: ['packages/*/src/**/*.paradedbtest.ts', 'apps/*/src/**/*.paradedbtest.ts'],
    env: { TEST_DATABASE_URL: 'postgres://liasse:liasse@127.0.0.1:54331/liasse_test' },
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
