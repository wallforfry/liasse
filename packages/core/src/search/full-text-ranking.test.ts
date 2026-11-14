import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.ts';
import { BM25_INDEX } from './bm25-index.ts';
import { prepareFullTextRanking } from './full-text-ranking.ts';
import { installedPgSearchVersion } from './pg-search.ts';
import { rankByFullText } from './rankers.ts';

// The path of a database without ParadeDB pg_search, the one `pnpm test` runs on. The BM25
// path needs pg_search and is covered by `pnpm test:paradedb`.
describe('prepareFullTextRanking without pg_search', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database.dispose();
  });

  const indexExists = async (): Promise<boolean> =>
    (await database.db.execute(sql`SELECT to_regclass(${BM25_INDEX}) AS index`))[0]?.index !== null;

  it('connects without any pg_search setting, which a pooler may refuse', async () => {
    const [row] = await database.db.execute(
      sql`SELECT current_setting('paradedb.planner_warnings', true) AS setting`,
    );
    expect(row?.setting).toBeNull();
  });

  it('reads no pg_search version', async () => {
    expect(await installedPgSearchVersion(database.db)).toBeUndefined();
  });

  it('ranks by ts_rank_cd, says nothing and creates no index', async () => {
    expect(await prepareFullTextRanking(database.db)).toEqual({
      ranker: rankByFullText,
      notice: undefined,
    });
    expect(await indexExists()).toBe(false);
  });

  it('ranks by ts_rank_cd and says why when pg_search is too old', async () => {
    const { ranker, notice } = await prepareFullTextRanking(database.db, () =>
      Promise.resolve('0.25.9'),
    );
    expect(ranker).toBe(rankByFullText);
    expect(notice).toBe(
      'Notice: pg_search 0.25.9 is installed, but BM25 ranking needs 0.26.0 or later. ' +
        'Full text is ranked by ts_rank_cd.',
    );
    expect(await indexExists()).toBe(false);
  });
});
