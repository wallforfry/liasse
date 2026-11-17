import { settingsStateSchema } from '@liasse/contract';
import { jobs } from '@liasse/core/db';
import { defineJobKind, enqueue, handle } from '@liasse/core/jobs';
import {
  createFakeModelFactories,
  createFakeTextModel,
  SYNTHETIC_SETTINGS,
  waitUntil,
} from '@liasse/core/testing';
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { Bind } from './bindings.ts';
import type { Runtime } from './create-runtime.ts';
import { bindWithFakes, useRuntimeHarness } from './runtime.test-helper.ts';

const probeJob = defineJobKind({
  name: 'synthetic_recovery_probe',
  schema: z.object({ label: z.string() }),
});

const models = createFakeModelFactories({
  textModel: (llm) => createFakeTextModel(() => ({ ok: true }), llm.textModel),
});

const llmOf = (textModel: string) => ({ ...SYNTHETIC_SETTINGS.llm, text_model: textModel });

// Records the text model of every set of settings a runtime puts in force.
const recording = () => {
  const models: string[] = [];
  const bind: Bind = (parts) => {
    models.push(parts.settings.llm.textModel);
    const defaults = bindWithFakes(parts);
    return {
      ...defaults,
      handlers: [...defaults.handlers, handle(probeJob, () => Promise.resolve())],
    };
  };
  return { bind, models };
};

describe('the settings across processes and secrets', () => {
  const harness = useRuntimeHarness();
  const { callAsPerson } = harness;

  const stateOf = async (runtime: Runtime) =>
    settingsStateSchema.parse(await (await callAsPerson(runtime, '/settings')).json());

  const save = async (runtime: Runtime, settings: unknown) =>
    callAsPerson(runtime, '/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: (await stateOf(runtime)).version, settings }),
    });

  const statusOf = async (id: string) =>
    (
      await harness.database().db.select({ status: jobs.status }).from(jobs).where(eq(jobs.id, id))
    )[0]?.status;

  it('puts in force in every process the settings one of them saves', async () => {
    const first = recording();
    const second = recording();
    const saver = await harness.start({}, { bind: first.bind, models }, { llm: llmOf('model-a') });
    await harness.startUnconfigured({}, { bind: second.bind, models });
    expect(second.models).toEqual(['model-a']);

    expect((await save(saver, { llm: llmOf('model-b') })).status).toBe(200);
    await waitUntil(() => second.models.includes('model-b'));
    expect(first.models).toEqual(['model-a', 'model-b']);
    expect(second.models).toEqual(['model-a', 'model-b']);
  });

  it('reads the stored version again when its listener connects again', async () => {
    const follower = recording();
    await harness.start({}, { bind: follower.bind, models }, { llm: llmOf('model-a') });
    const { db } = harness.database();
    // A save this process never hears of: no notification goes with it.
    await db.execute(sql`UPDATE settings SET version = version + 1,
      document = jsonb_set(document, '{llm,text_model}', '"model-c"')`);
    await db.execute(sql`SELECT pg_terminate_backend(pid) FROM pg_stat_activity
      WHERE datname = current_database() AND pid <> pg_backend_pid() AND query ILIKE 'listen%'`);
    await waitUntil(() => follower.models.includes('model-c'));
  });

  it('starts when AUTH_SECRET changed, and takes a replaced key without the old one', async () => {
    const key = 'synthetic-anthropic-key-0d4e';
    const anthropic = { ...llmOf('model-a'), provider: 'anthropic' } as const;
    const before = await harness.start({}, { models }, { llm: { ...anthropic, api_key: key } });
    await before.stop();

    const probe = recording();
    const runtime = await harness.startUnconfigured(
      { AUTH_SECRET: 'another-synthetic-auth-secret-0123456789' },
      { bind: probe.bind, models },
    );
    expect(harness.lines()).toContain(
      'Notice: the key of the llm settings does not decrypt: AUTH_SECRET changed since it was ' +
        'saved. Liasse processes nothing until it is replaced or cleared with PUT /settings, ' +
        'or AUTH_SECRET is restored.',
    );
    expect(harness.lines().some((line) => line.includes(key))).toBe(false);
    expect(probe.models).toEqual([]);
    expect((await harness.call(runtime, '/types')).status).toBe(503);
    expect((await stateOf(runtime)).settings?.llm.api_key_state).toBe('unreadable');

    expect((await save(runtime, { llm: anthropic })).status).toBe(400);
    const replaced = await save(runtime, {
      llm: { ...anthropic, api_key: { action: 'replace', value: 'synthetic-new-key-0d4e' } },
    });
    expect(replaced.status).toBe(200);
    expect(probe.models).toEqual(['model-a']);
    expect((await harness.call(runtime, '/types')).status).toBe(200);
    expect((await stateOf(runtime)).settings?.llm.api_key_state).toBe('set');
  });

  it('keeps the settings in force and the workers running when a startup task fails', async () => {
    const bind: Bind = (parts) => {
      const defaults = bindWithFakes(parts);
      return {
        ...defaults,
        handlers: [...defaults.handlers, handle(probeJob, () => Promise.resolve())],
        startupTasks: [
          ...defaults.startupTasks,
          { name: 'a synthetic task', run: () => Promise.reject(new Error('synthetic')) },
        ],
      };
    };
    const runtime = await harness.startUnconfigured({}, { bind, models });
    expect((await save(runtime, { llm: llmOf('model-a') })).status).toBe(200);
    expect(harness.lines()).toContain(
      '{"event":"settings_task_failed","task":"a synthetic task","error":"Error"}',
    );
    const id = await enqueue(harness.database().db, { kind: probeJob, payload: { label: 'x' } });
    await waitUntil(async () => (await statusOf(id)) === 'succeeded');
  });
});
