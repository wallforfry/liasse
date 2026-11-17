import { settingsStateSchema } from '@liasse/contract';
import { StartupError } from '@liasse/core/domain';
import { processDocumentJob } from '@liasse/core/ingest';
import { handle } from '@liasse/core/jobs';
import {
  createFakeEmbedder,
  createFakeModelFactories,
  createGate,
  SYNTHETIC_SETTINGS,
  waitUntil,
} from '@liasse/core/testing';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Bind } from './bindings.ts';
import type { Runtime } from './create-runtime.ts';
import { bindWithFakes, useRuntimeHarness, withoutHandlers } from './runtime.test-helper.ts';

const remote = (model: string) =>
  ({ provider: 'ollama', model, base_url: 'http://127.0.0.1:9' }) as const;

describe('the settings a job was queued under', () => {
  const harness = useRuntimeHarness();
  const { callAsPerson } = harness;

  const save = async (runtime: Runtime, settings: unknown) => {
    const state = settingsStateSchema.parse(
      await (await callAsPerson(runtime, '/settings')).json(),
    );
    return callAsPerson(runtime, '/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: state.version, settings }),
    });
  };

  it('are put in force by the process that claims the job before it runs it', async () => {
    // The follower holds the embedder of the new settings until the gate opens.
    const held = createGate();
    const followerModels = createFakeModelFactories({
      embedder: ({ dimension, model }) => ({
        ...createFakeEmbedder({ dimension }),
        model: model ?? 'local',
      }),
    });
    const slowFollower = {
      ...followerModels,
      embedder: async (...args: Parameters<typeof followerModels.embedder>) => {
        if (args[0].model === 'new-embedding-model') await held.opened;
        return followerModels.embedder(...args);
      },
    };
    const used: string[] = [];
    const follower: Bind = (parts) => {
      const defaults = bindWithFakes(parts);
      return {
        ...defaults,
        handlers: [
          ...defaults.handlers.filter(({ kind }) => kind !== processDocumentJob.name),
          handle(processDocumentJob, () => {
            used.push(parts.embedder.model);
            return Promise.resolve();
          }),
        ],
      };
    };
    const saving = { llm: SYNTHETIC_SETTINGS.llm, embedding: remote('old-embedding-model') };
    // The saver processes no document: the follower claims every one.
    const saver = await harness.start(
      {},
      { bind: withoutHandlers(processDocumentJob.name), models: createFakeModelFactories() },
      saving,
    );
    await harness.startUnconfigured({}, { bind: follower, models: slowFollower });

    const saved = await save(saver, { ...saving, embedding: remote('new-embedding-model') });
    expect(saved.status).toBe(200);
    const id = await harness.upload(saver, ['A synthetic letter.'], 'letter.pdf');
    await waitUntil(async () =>
      (await harness.jobsOf(processDocumentJob.name, id)).some(({ status }) => status !== 'queued'),
    );
    expect(used).toEqual([]);
    held.open();
    await waitUntil(() => used.length === 1);
    expect(used).toEqual(['new-embedding-model']);
  });

  it('are read again, with a growing delay, after a reading of the follower fails', async () => {
    const models: string[] = [];
    const bind: Bind = (parts) => {
      models.push(parts.settings.llm.textModel);
      return bindWithFakes(parts);
    };
    await harness.start({}, { bind, models: createFakeModelFactories() });
    const { db } = harness.database();
    await db.execute(sql`ALTER TABLE settings RENAME TO settings_away`);
    try {
      await db.execute(sql`SELECT pg_notify('liasse_settings', '99')`);
      await waitUntil(() =>
        harness.lines().some((line) => line.includes('"event":"settings_follow_failed"')),
      );
    } finally {
      await db.execute(sql`ALTER TABLE settings_away RENAME TO settings`);
    }
    // No notification follows: only the retry can see this version.
    await db.execute(sql`UPDATE settings SET version = version + 1,
      document = jsonb_set(document, '{llm,text_model}', '"retried-model"')`);
    await waitUntil(() => models.includes('retried-model'));
  });

  it('stop the startup when a startup task fails at boot, as before', async () => {
    const bind: Bind = (parts) => ({
      ...bindWithFakes(parts),
      startupTasks: [{ name: 'a synthetic task', run: () => Promise.reject(new Error('no')) }],
    });
    const failure = await harness.start({}, { bind, models: createFakeModelFactories() }).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(StartupError);
    expect(String(failure)).toContain('a synthetic task failed');
  });

  it('retry after a save a startup task that failed, until it succeeds', async () => {
    let runs = 0;
    const bind: Bind = (parts) => ({
      ...bindWithFakes(parts),
      startupTasks: [
        {
          name: 'a flaky synthetic task',
          run: () => {
            runs += 1;
            return runs === 1 ? Promise.reject(new Error('once')) : Promise.resolve();
          },
        },
      ],
    });
    const runtime = await harness.startUnconfigured(
      {},
      { bind, models: createFakeModelFactories() },
    );
    expect((await save(runtime, { llm: SYNTHETIC_SETTINGS.llm })).status).toBe(200);
    expect(harness.lines()).toContain(
      '{"event":"settings_task_failed","task":"a flaky synthetic task","error":"Error"}',
    );
    await waitUntil(() => runs === 2);
  });
});
