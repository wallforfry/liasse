import { docTypes, entities } from '@liasse/core/db';
import { PROVENANCE_ENTITY_ID_KEY } from '@liasse/core/domain';
import { renderTypeSchema } from '@liasse/core/registry';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { callTool, createMcpHarness, type McpHarness } from './harness.test-helper.ts';

const counted = z.object({ document_count: z.int() });
const typeList = z.object({ types: z.tuple([counted]) });
const entityList = z.object({ entities: z.tuple([counted]) });
const contents = z.object({ contents: z.tuple([z.object({ text: z.string() })]) });

// A type and an entity known only from one private document: the counts of REST leave it
// out unless asked for, and the MCP layer must give the same counts.
describe('the counts of private documents', () => {
  let harness: McpHarness;
  let client: Client;

  beforeAll(async () => {
    harness = await createMcpHarness();
    client = await harness.connect();
    const [type] = await harness.database.db
      .insert(docTypes)
      .values({
        slug: 'payslip',
        description: 'Synthetic payslips',
        schema: renderTypeSchema({}),
      })
      .returning({ id: docTypes.id });
    const [entity] = await harness.database.db
      .insert(entities)
      .values({ kind: 'org', canonicalName: 'Atelier Zircon' })
      .returning({ id: entities.id });
    if (type === undefined || entity === undefined) throw new Error('the seed was not inserted');
    await harness.addDocument([], {
      typeId: type.id,
      private: true,
      provenance: { issuer: { [PROVENANCE_ENTITY_ID_KEY]: entity.id } },
    });
  });

  afterAll(async () => {
    await harness.dispose();
  });

  const typeCount = async (args: Readonly<Record<string, unknown>>) =>
    typeList.parse((await callTool(client, 'describe_types', args)).body).types[0].document_count;

  const entityCount = async (args: Readonly<Record<string, unknown>>) =>
    entityList.parse((await callTool(client, 'list_entities', args)).body).entities[0]
      .document_count;

  it('leaves them out of describe_types unless include_private is true', async () => {
    expect(await typeCount({})).toBe(0);
    expect(await typeCount({ include_private: true })).toBe(1);
  });

  it('leaves them out of list_entities unless include_private is true', async () => {
    expect(await entityCount({})).toBe(0);
    expect(await entityCount({ include_private: true })).toBe(1);
  });

  it('leaves them out of types://', async () => {
    const [{ text }] = contents.parse(await client.readResource({ uri: 'types://' })).contents;
    expect(typeList.parse(JSON.parse(text)).types[0].document_count).toBe(0);
  });
});
