import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createHttpHarness, type HttpHarness, jsonRequest } from '../harness.test-helper.ts';
import { signIn } from '../ui/ui.test-helper.ts';

const createdSchema = z.object({ id: z.string(), key: z.string(), name: z.string() });
const listedSchema = z.object({
  apiKeys: z.array(z.looseObject({ id: z.string(), name: z.string().nullable() })),
});

describe('API keys from a session of the web UI', () => {
  let harness: HttpHarness;

  beforeAll(async () => {
    harness = await createHttpHarness();
  });

  afterAll(async () => {
    await harness.dispose();
  });

  it('creates a key shown once, which then opens the API until it is deleted', async () => {
    const session = await signIn(harness.app);
    const response = await session.request(
      '/api/auth/api-key/create',
      jsonRequest('POST', { name: 'synthetic agent' }),
    );
    expect(response.status).toBe(200);
    const created = createdSchema.parse(await response.json());
    expect(created.key).toMatch(/^liasse_/);
    expect((await harness.app.request('/types', harness.authorized({}, created.key))).status).toBe(
      200,
    );

    const listed = await session.request('/api/auth/api-key/list');
    const { apiKeys } = listedSchema.parse(await listed.json());
    expect(apiKeys.map(({ name }) => name)).toContain('synthetic agent');
    expect(JSON.stringify(apiKeys)).not.toContain(created.key);

    const deleted = await session.request(
      '/api/auth/api-key/delete',
      jsonRequest('POST', { keyId: created.id }),
    );
    expect(deleted.status).toBe(200);
    expect((await harness.app.request('/types', harness.authorized({}, created.key))).status).toBe(
      401,
    );
  });

  it('creates no key without a session, nor for a request from another origin', async () => {
    const anonymous = await harness.app.request(
      '/api/auth/api-key/create',
      jsonRequest('POST', { name: 'synthetic anonymous' }),
    );
    expect(anonymous.status).toBe(401);
    const session = await signIn(harness.app);
    const foreign = await session.request(
      '/api/auth/api-key/create',
      {
        ...jsonRequest('POST', { name: 'synthetic foreign' }),
        headers: { 'Content-Type': 'application/json', Origin: 'https://attacker.example.net' },
      },
      false,
    );
    expect(foreign.status).toBe(403);
  });

  it('does not let an API key manage keys', async () => {
    const response = await harness.app.request(
      '/api/auth/api-key/create',
      harness.authorized(jsonRequest('POST', { name: 'synthetic escalation' })),
    );
    expect(response.status).toBe(401);
  });
});
