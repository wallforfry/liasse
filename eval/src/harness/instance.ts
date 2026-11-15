import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Config, loadConfig } from '@liasse/core/config';
import type { Database } from '@liasse/core/db';
import { createApiKeyOverHttp, createTestDatabase } from '@liasse/core/testing';
import { createRuntime, type RuntimeOptions } from '@liasse/server/runtime';

export type Env = Readonly<Record<string, string | undefined>>;

/** A Liasse server of its own, on a database and a folder that exist for one run. */
export interface Instance {
  readonly config: Config;
  readonly baseUrl: string;
  /** An API key of the one account of the instance, both made for the run. */
  readonly token: string;
  /** A connection of the harness to the database of the instance, to read what it stored. */
  readonly db: Database;
  readonly stop: () => Promise<void>;
}

interface RunAccount {
  readonly email: string;
  readonly password: string;
}

// Everything that would reach outside the run is switched off: the watched folder, the
// Hindsight bank and the accounts of the operator's configuration. The models and the
// embedder stay as configured: they are what a run measures.
const throwawayEnv = (env: Env, databaseUrl: string, folder: string, account: RunAccount): Env => ({
  ...env,
  DATABASE_URL: databaseUrl,
  STORAGE_DRIVER: 'fs',
  STORAGE_PATH: join(folder, 'files'),
  WATCH_DIR: undefined,
  HINDSIGHT_URL: undefined,
  HINDSIGHT_API_KEY: undefined,
  AUTH_SECRET: randomBytes(32).toString('hex'),
  AUTH_BOOTSTRAP_EMAIL: account.email,
  AUTH_BOOTSTRAP_PASSWORD: account.password,
  HOST: '127.0.0.1',
  PORT: undefined,
  PUBLIC_URL: undefined,
});

/**
 * Starts the real server, the one `createRuntime` builds, on a throwaway database of the
 * test Postgres (`TEST_DATABASE_URL`) and a temporary folder. The configuration is read
 * from `env` like the server reads it, with the overrides above.
 */
export const startInstance = async (
  env: Env,
  { logger }: Pick<RuntimeOptions, 'logger'> = {},
): Promise<Instance> => {
  const database = await createTestDatabase({ migrate: false });
  const folder = await mkdtemp(join(tmpdir(), 'liasse-eval-'));
  const discard = async (): Promise<void> => {
    await rm(folder, { recursive: true, force: true });
    await database.dispose();
  };
  try {
    const account = { email: 'eval@example.com', password: randomBytes(32).toString('hex') };
    const loaded = loadConfig(throwawayEnv(env, database.url, folder, account));
    // Port 0 lets the system pick a free one; the configuration itself refuses it.
    const config = { ...loaded, server: { ...loaded.server, port: 0 } };
    const runtime = await createRuntime(config, logger === undefined ? {} : { logger });
    if (runtime.port === undefined) {
      await runtime.stop();
      throw new Error('The server of the run listens on no port');
    }
    const baseUrl = `http://127.0.0.1:${String(runtime.port)}`;
    const token = await createApiKeyOverHttp({
      baseUrl,
      publicUrl: config.server.publicUrl,
      account,
      name: 'evaluation run',
    }).catch(async (error: unknown) => {
      await runtime.stop();
      throw error;
    });
    // An interrupted run stops the instance from its signal handler, then again on its way
    // out: the second call waits for the first.
    let stopped: Promise<void> | undefined;
    return {
      config,
      baseUrl,
      token,
      db: database.db,
      stop: () => {
        stopped ??= runtime.stop().then(discard);
        return stopped;
      },
    };
  } catch (error) {
    await discard();
    throw error;
  }
};
