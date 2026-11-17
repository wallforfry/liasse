import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { callTool, createMcpHarness, type McpHarness } from './harness.test-helper.ts';

const failure = z.object({
  error: z.looseObject({ code: z.string(), message: z.string() }),
});

const DRAFT = {
  slug: 'water_bill',
  description: 'Bill from a water supplier',
  parent_slug: null,
  fields: { volume: { type: 'number' } },
} as const;

describe('the tools that manage types', () => {
  let harness: McpHarness;
  let client: Client;

  beforeAll(async () => {
    harness = await createMcpHarness();
    client = await harness.connect();
  });

  afterAll(async () => {
    await harness.dispose();
  });

  const failureOf = async (name: string, args: Readonly<Record<string, unknown>>) => {
    const { isError, body } = await callTool(client, name, args);
    expect(isError).toBe(true);
    return failure.parse(body).error;
  };

  it('creates a provisional type that describe_types then lists', async () => {
    const { isError, body } = await callTool(client, 'create_type', {
      slug: 'energy_bill',
      description: 'Bill from an electricity or gas supplier',
      fields: { energy: { type: 'enum', values: ['electricity', 'gas'] } },
    });
    expect(isError).toBe(false);
    expect(body).toEqual({
      slug: 'energy_bill',
      description: 'Bill from an electricity or gas supplier',
      parent_slug: null,
      version: 1,
      status: 'provisional',
      aliases: [],
      fields: { energy: { type: 'enum', values: ['electricity', 'gas'] } },
      document_count: 0,
    });
    const listed = z
      .object({ types: z.array(z.looseObject({ slug: z.string() })) })
      .parse((await callTool(client, 'describe_types')).body);
    expect(listed.types.map(({ slug }) => slug)).toContain('energy_bill');
  });

  it('answers a refusal of the registry with its code and what to correct', async () => {
    const refusal = await failureOf('create_type', { slug: 'Bill-October', description: 'A bill' });
    expect(refusal).toMatchObject({ code: 'invalid_slug', slug: 'Bill-October' });
    await callTool(client, 'create_type', { slug: 'payslip', description: 'A payslip' });
    expect(
      await failureOf('create_type', { slug: 'payslip', description: 'Another payslip' }),
    ).toMatchObject({ code: 'name_taken', name: 'payslip' });
  });

  it('refuses an argument the schema does not know', async () => {
    const result = await client.callTool({
      name: 'create_type',
      arguments: { slug: 'receipt', description: 'A receipt', status: 'stable' },
    });
    expect(result.isError).toBe(true);
  });

  it.each([
    ['suggest_type', { request: 'my water bills' }],
    ['request_consolidation_run', {}],
    ['list_consolidation_runs', {}],
    ['list_subjects', {}],
  ])('answers not_implemented from %s, as REST answers 501', async (name, args) => {
    expect((await failureOf(name, args)).code).toBe('not_implemented');
  });
});

describe('the tools that manage types, with their features bound', () => {
  let harness: McpHarness;

  beforeAll(async () => {
    harness = await createMcpHarness();
  });

  afterAll(async () => {
    await harness.dispose();
  });

  it('drafts a type from the request, trimmed, and stores nothing', async () => {
    const requests: string[] = [];
    const client = await harness.connect({
      suggestType: (request) => {
        requests.push(request);
        return Promise.resolve(DRAFT);
      },
    });
    const { isError, body } = await callTool(client, 'suggest_type', {
      request: '  my water bills, with the volume  ',
    });
    expect(isError).toBe(false);
    expect(body).toEqual(DRAFT);
    expect(requests).toEqual(['my water bills, with the volume']);
    expect((await callTool(client, 'describe_types')).body).toEqual({ types: [] });
  });

  it('asks for a consolidation run and lists the runs', async () => {
    const run = {
      id: 'job_x',
      trigger: 'manual',
      status: 'queued',
      attempts: 0,
      queued_at: '2026-11-17T08:00:00.000Z',
      due_at: '2026-11-17T08:00:00.000Z',
      last_error: null,
    };
    const client = await harness.connect({
      requestConsolidationRun: () => Promise.resolve({ queued: true }),
      listConsolidationRuns: () => Promise.resolve({ runs: [run] }),
    });
    expect((await callTool(client, 'request_consolidation_run')).body).toEqual({ queued: true });
    expect((await callTool(client, 'list_consolidation_runs')).body).toEqual({ runs: [run] });
  });

  it('hands list_subjects its filters', async () => {
    const received: unknown[] = [];
    const client = await harness.connect({
      listSubjects: (options) => {
        received.push(options);
        return Promise.resolve({ subjects: [], truncated: false });
      },
    });
    const { body } = await callTool(client, 'list_subjects', {
      kind: 'vehicle',
      query: ' van ',
    });
    expect(body).toEqual({ subjects: [], truncated: false });
    expect(received).toEqual([{ kind: 'vehicle', query: 'van' }]);
  });
});
