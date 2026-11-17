import type { SettingsContext } from '@liasse/core/api';
import { createDb } from '@liasse/core/db';
import { createSecretBox } from '@liasse/core/settings';
import {
  createFakeModelFactories,
  createTestDatabase,
  SYNTHETIC_EMBEDDING_ENVIRONMENT,
  SYNTHETIC_ENV,
  seedSettings,
  syntheticSettings,
  type TestDatabase,
} from '@liasse/core/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createLogger } from '../log.ts';
import { createSettingsFollower } from './follow.ts';

describe('createSettingsFollower', () => {
  let database: TestDatabase;
  const lines: string[] = [];
  const logger = createLogger((line) => lines.push(line));

  const contextOf = (db: SettingsContext['db']): SettingsContext => ({
    db,
    secrets: createSecretBox(SYNTHETIC_ENV.AUTH_SECRET),
    embedding: SYNTHETIC_EMBEDDING_ENVIRONMENT,
    factories: createFakeModelFactories(),
    prepare: () => Promise.reject(new Error('not used')),
  });

  beforeAll(async () => {
    database = await createTestDatabase();
    await seedSettings({
      databaseUrl: database.url,
      authSecret: SYNTHETIC_ENV.AUTH_SECRET,
      embeddingDim: SYNTHETIC_EMBEDDING_ENVIRONMENT.dimension,
      settings: syntheticSettings(),
    });
  });

  afterEach(() => {
    lines.length = 0;
    vi.useRealTimers();
  });

  afterAll(async () => {
    await database.dispose();
  });

  it('builds settings it could not put in force once, until their version changes', async () => {
    let builds = 0;
    const follower = createSettingsFollower(
      contextOf(database.db),
      {
        version: () => 0,
        prepare: () => {
          builds += 1;
          return Promise.reject(new Error('synthetic'));
        },
      },
      logger,
    );
    await follower.catchUp();
    await follower.catchUp();
    await follower.catchUp();
    expect(builds).toBe(1);
    expect(lines.filter((line) => line.includes('settings_apply_failed'))).toEqual([
      '{"event":"settings_apply_failed","version":1,"error":"Error"}',
    ]);
    await follower.stop();
  });

  it('cancels the retry of a failed reading when it stops', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const closed = createDb(database.url);
    await closed.close();
    const follower = createSettingsFollower(
      contextOf(closed.db),
      { version: () => 0, prepare: () => Promise.reject(new Error('not used')) },
      logger,
    );
    await follower.catchUp();
    expect(lines.some((line) => line.includes('settings_follow_failed'))).toBe(true);
    expect(vi.getTimerCount()).toBe(1);
    await follower.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});
