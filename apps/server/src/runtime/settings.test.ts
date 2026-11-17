import { settingsStateSchema } from '@liasse/contract';
import { jobs, settings as settingsTable } from '@liasse/core/db';
import { defineJobKind, enqueue, handle } from '@liasse/core/jobs';
import {
  createFakeModelFactories,
  createFakeTextModel,
  createGate,
  insertSyntheticDocument,
  SYNTHETIC_SETTINGS,
  waitUntil,
} from '@liasse/core/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { Runtime } from './create-runtime.ts';
import type { Bind } from './bindings.ts';
import { bindWithFakes, useRuntimeHarness } from './runtime.test-helper.ts';

const probeJob = defineJobKind({
  name: 'synthetic_probe',
  schema: z.object({ label: z.string() }),
});

const errorSchema = z.object({ error: z.object({ code: z.string() }) });

// The text model of the settings names itself after the model they name.
const models = createFakeModelFactories({
  textModel: (llm) => createFakeTextModel(() => ({ ok: true }), llm.textModel),
});

const llmOf = (textModel: string) => ({ ...SYNTHETIC_SETTINGS.llm, text_model: textModel });

describe('the settings of a running server', () => {
  const harness = useRuntimeHarness();
  const { callAsPerson } = harness;

  const json = (method: string, body: unknown): RequestInit => ({
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const stateOf = async (runtime: Runtime) =>
    settingsStateSchema.parse(await (await callAsPerson(runtime, '/settings')).json());

  const save = async (runtime: Runtime, settings: unknown, version?: number) =>
    callAsPerson(
      runtime,
      '/settings',
      json('PUT', { version: version ?? (await stateOf(runtime)).version, settings }),
    );

  const statusOf = async (id: string) =>
    (
      await harness.database().db.select({ status: jobs.status }).from(jobs).where(eq(jobs.id, id))
    )[0]?.status;

  // A probe records the text model it ran with; the one labelled `slow` waits for a gate.
  const probing = () => {
    const seen: { readonly label: string; readonly model: string }[] = [];
    const started = createGate();
    const release = createGate();
    let binds = 0;
    const bind: Bind = (parts) => {
      binds += 1;
      const defaults = bindWithFakes(parts);
      return {
        ...defaults,
        handlers: [
          ...defaults.handlers,
          handle(probeJob, async ({ payload }) => {
            if (payload.label === 'slow') {
              started.open();
              await release.opened;
            }
            const { model } = await parts.textModel.generateObject({
              schema: z.object({}),
              system: 'probe',
              prompt: payload.label,
            });
            seen.push({ label: payload.label, model });
          }),
        ],
      };
    };
    return { bind, seen, started, release, binds: () => binds };
  };

  it('starts unconfigured: HTTP answers, nothing runs, and a save starts the workers', async () => {
    const probe = probing();
    const runtime = await harness.startUnconfigured({}, { bind: probe.bind, models });
    expect(harness.lines()).toContain(
      'Notice: Liasse has no settings yet. It processes no document until they are saved: ' +
        'sign in to the web UI, then save them with PUT /settings.',
    );
    expect((await harness.call(runtime, '/health')).status).toBe(200);
    const refused = await harness.call(runtime, '/types');
    expect(refused.status).toBe(503);
    expect(errorSchema.parse(await refused.json()).error.code).toBe('not_configured');
    expect(await stateOf(runtime)).toEqual({
      version: 0,
      updated_at: null,
      settings: null,
      embedder_locked: false,
    });

    const id = await enqueue(harness.database().db, {
      kind: probeJob,
      payload: { label: 'early' },
    });
    expect(probe.binds()).toBe(0);
    expect(await statusOf(id)).toBe('queued');

    expect((await save(runtime, { llm: llmOf('model-a') })).status).toBe(200);
    await waitUntil(async () => (await statusOf(id)) === 'succeeded');
    expect(probe.seen).toEqual([{ label: 'early', model: 'model-a' }]);
    expect((await harness.call(runtime, '/types')).status).toBe(200);
  });

  it('applies a save at once: a job claimed after it runs with the new model', async () => {
    const probe = probing();
    const runtime = await harness.start(
      {},
      { bind: probe.bind, models },
      { llm: llmOf('model-a') },
    );
    const { db } = harness.database();
    const slow = await enqueue(db, { kind: probeJob, payload: { label: 'slow' } });
    await probe.started.opened;

    const saved = await save(runtime, { llm: llmOf('model-b') });
    expect(saved.status).toBe(200);
    expect(settingsStateSchema.parse(await saved.json()).settings?.llm.text_model).toBe('model-b');
    const after = await enqueue(db, { kind: probeJob, payload: { label: 'after' } });
    await waitUntil(async () => (await statusOf(after)) === 'succeeded');
    probe.release.open();
    await waitUntil(async () => (await statusOf(slow)) === 'succeeded');

    expect(probe.seen).toEqual([
      { label: 'after', model: 'model-b' },
      { label: 'slow', model: 'model-a' },
    ]);
  });

  it('refuses a save of a stale version, and changes nothing', async () => {
    const runtime = await harness.start({}, { models });
    const { version } = await stateOf(runtime);
    expect((await save(runtime, { llm: llmOf('model-b') }, version)).status).toBe(200);
    const stale = await save(runtime, { llm: llmOf('model-c') }, version);
    expect(stale.status).toBe(409);
    expect(errorSchema.parse(await stale.json()).error.code).toBe('settings_conflict');
    expect((await stateOf(runtime)).settings?.llm.text_model).toBe('model-b');
  });

  it('locks the embedder once a live document exists, and nothing else', async () => {
    const runtime = await harness.start({}, { models });
    const remote = { provider: 'ollama', model: 'embedding-model', base_url: 'http://127.0.0.1:9' };
    expect((await save(runtime, { llm: llmOf('model-a'), embedding: remote })).status).toBe(200);
    await insertSyntheticDocument(harness.database().db, { status: 'indexed' });
    expect((await stateOf(runtime)).embedder_locked).toBe(true);

    const changed = await save(runtime, {
      llm: llmOf('model-a'),
      embedding: { ...remote, model: 'other-embedding-model' },
    });
    expect(changed.status).toBe(409);
    expect(errorSchema.parse(await changed.json()).error.code).toBe('embedder_locked');
    const kept = await save(runtime, {
      llm: llmOf('model-b'),
      embedding: { ...remote, timeout_ms: 5000 },
    });
    expect(kept.status).toBe(200);
  });

  it('answers the settings to a session only, never to an API key', async () => {
    const runtime = await harness.start({}, { models });
    expect((await harness.call(runtime, '/settings')).status).toBe(401);
    const put = await harness.call(
      runtime,
      '/settings',
      json('PUT', { version: 1, settings: { llm: llmOf('model-b') } }),
    );
    expect(put.status).toBe(401);
    const check = await harness.call(
      runtime,
      '/settings/check',
      json('POST', { settings: { llm: llmOf('model-b') } }),
    );
    expect(check.status).toBe(401);
    expect((await stateOf(runtime)).settings?.llm.text_model).toBe('text-model');
  });

  it('never answers a key, and keeps it when a save says nothing of it', async () => {
    const runtime = await harness.start(
      {},
      { models },
      { llm: { provider: 'anthropic', api_key: 'synthetic-anthropic-key-5c1d' } },
    );
    const read = await callAsPerson(runtime, '/settings');
    const body = await read.text();
    expect(body).not.toContain('synthetic-anthropic-key-5c1d');
    expect(settingsStateSchema.parse(JSON.parse(body)).settings?.llm.api_key_state).toBe('set');
    const anthropic = { ...llmOf('model-b'), provider: 'anthropic' };
    expect((await save(runtime, { llm: anthropic })).status).toBe(200);
    const cleared = await save(runtime, { llm: { ...anthropic, api_key: { action: 'clear' } } });
    expect(cleared.status).toBe(400);
    const [row] = await harness.database().db.select().from(settingsTable);
    expect(JSON.stringify(row)).not.toContain('synthetic-anthropic-key-5c1d');
  });

  it('checks settings without saving them', async () => {
    const runtime = await harness.start({}, { models });
    const response = await callAsPerson(
      runtime,
      '/settings/check',
      json('POST', { settings: { llm: llmOf('model-b') } }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      text_model: { status: 'ok' },
      vision_model: { status: 'ok' },
      embedder: { status: 'ok' },
      hindsight: { status: 'skipped' },
    });
    expect((await stateOf(runtime)).settings?.llm.text_model).toBe('text-model');
  });
});
