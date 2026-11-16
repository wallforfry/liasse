import {
  DEFAULT_TIMELINE_LIMIT,
  MAX_QUERY_ENTITY_NAME_LENGTH,
  MAX_QUERY_ENTITY_NAMES,
} from '@liasse/contract/domain';
import { recordDocumentEvent } from '@liasse/core/processing-log';
import { syntheticPdf } from '@liasse/core/testing';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { callTool, createMcpHarness, type McpHarness } from './harness.test-helper.ts';

const TOOLS = [
  'apply_change',
  'describe_types',
  'get_document',
  'get_status',
  'get_subject',
  'ingest',
  'list_entities',
  'list_pending_changes',
  'query',
  'recall',
  'reclassify_document',
  'retry_document',
  'search',
  'timeline',
  'upcoming',
  'update_document',
];

// The tools whose answer is read from documents.
const UNTRUSTED_TOOLS = TOOLS.filter(
  (name) =>
    !['apply_change', 'get_status', 'ingest', 'reclassify_document', 'retry_document'].includes(
      name,
    ),
);

const hits = z.object({ results: z.array(z.object({ id: z.string() })) });
const rows = z.object({ rows: z.array(z.object({ id: z.string() })) });
const failure = z.object({
  error: z.looseObject({ code: z.string(), message: z.string() }),
});

describe('the tools', () => {
  let harness: McpHarness;
  let client: Client;
  let publicId: string;
  let privateId: string;

  beforeAll(async () => {
    harness = await createMcpHarness();
    client = await harness.connect();
    publicId = await harness.addDocument(['Synthetic zircon invoice of the workshop'], {
      title: 'Public invoice',
    });
    privateId = await harness.addDocument(['Synthetic zircon payslip of the workshop'], {
      title: 'Private payslip',
      private: true,
    });
  });

  afterAll(async () => {
    await harness.dispose();
  });

  const failureOf = async (name: string, args: Readonly<Record<string, unknown>>) => {
    const { isError, body } = await callTool(client, name, args);
    expect(isError).toBe(true);
    return failure.parse(body).error;
  };

  it('lists the sixteen tools, flagging document content as untrusted', async () => {
    const { tools } = await client.listTools();
    expect(tools.map(({ name }) => name).toSorted()).toEqual(TOOLS);
    const flagged = tools
      .filter(({ description }) => description?.includes('untrusted data') === true)
      .map(({ name }) => name);
    expect(flagged.toSorted()).toEqual(UNTRUSTED_TOOLS);
  });

  // The notes the verdicts on the query DSL (#29) asked agents to be told, in their own words.
  it('tells agents what query discloses and how it compares and returns values', async () => {
    const { tools } = await client.listTools();
    const description = tools.find(({ name }) => name === 'query')?.description ?? '';
    const notes = [
      'Even when they are left out, a name compared with an entity reveals whether an ' +
        'entity bears that name when only private documents refer to it, though no ' +
        'document, count or amount of theirs is returned.',
      `A name is compared with the canonical name and the first ${String(MAX_QUERY_ENTITY_NAMES - 1)} ` +
        `aliases of each entity, each cut to its first ${String(MAX_QUERY_ENTITY_NAME_LENGTH)} characters.`,
      'aggregate values and numeric group keys are a JSON number or an exact decimal string.',
      'Rows, snippets and the data fields of errors carry document text.',
    ];
    expect(notes.filter((note) => !description.includes(note))).toEqual([]);
  });

  it('says the entity and type lists keep names known only from private documents', async () => {
    const { tools } = await client.listTools();
    const descriptionOf = (name: string) =>
      tools.find((tool) => tool.name === name)?.description ?? '';
    expect(descriptionOf('list_entities')).toContain(
      'an entity known only from private documents is still listed, with its names and a ' +
        'count of 0.',
    );
    expect(descriptionOf('describe_types')).toContain(
      'a type known only from private documents is still listed, with a count of 0.',
    );
  });

  it('shows the DSL as the input schema of query, and strict schemas elsewhere', async () => {
    const { tools } = await client.listTools();
    const schemaOf = (name: string) => tools.find((tool) => tool.name === name)?.inputSchema;
    expect(schemaOf('query')).toMatchObject({
      properties: { group_by: {}, include_private: {} },
      additionalProperties: false,
    });
    expect(schemaOf('search')).toMatchObject({ additionalProperties: false });
    expect(schemaOf('get_document')).toMatchObject({ required: ['id'] });
  });

  describe('search', () => {
    const idsOf = async (args: Readonly<Record<string, unknown>>) =>
      hits.parse((await callTool(client, 'search', args)).body).results.map(({ id }) => id);

    it('returns private documents only when include_private is true', async () => {
      expect(await idsOf({ query: 'zircon' })).toEqual([publicId]);
      expect((await idsOf({ query: 'zircon', include_private: true })).toSorted()).toEqual(
        [publicId, privateId].toSorted(),
      );
    });

    it('refuses an argument the schema does not know', async () => {
      const result = await client.callTool({
        name: 'search',
        arguments: { query: 'zircon', includePrivate: true },
      });
      expect(result.isError).toBe(true);
    });

    it('answers invalid_request for a character Postgres cannot hold', async () => {
      const error = await failureOf('search', { query: 'zircon', filters: { type: 'a\u0000b' } });
      expect(error.code).toBe('invalid_request');
    });
  });

  describe('query', () => {
    it('leaves private documents out unless include_private is true', async () => {
      const idsOf = async (args: Readonly<Record<string, unknown>>) =>
        rows.parse((await callTool(client, 'query', args)).body).rows.map(({ id }) => id);
      expect(await idsOf({})).toEqual([publicId]);
      expect((await idsOf({ include_private: true })).toSorted()).toEqual(
        [publicId, privateId].toSorted(),
      );
    });

    it('answers the errors of the DSL itself, as REST does', async () => {
      const error = await failureOf('query', {
        where: [['core.isuer', '=', 'x']],
        colour: 'blue',
      });
      expect(error).toMatchObject({
        code: 'invalid_query',
        errors: [{ code: 'invalid_query', path: [] }],
      });
      expect(error.message).toBe('The query was refused.');
      const unknownField = await failureOf('query', { where: [['core.isuer', '=', 'x']] });
      expect(unknownField).toMatchObject({
        code: 'invalid_query',
        errors: [{ code: 'unknown_field', suggestion: 'core.issuer' }],
      });
    });
  });

  describe('get_document and get_status', () => {
    it('returns a private document asked for by its id', async () => {
      const { isError, body } = await callTool(client, 'get_document', {
        id: privateId,
        include: ['text'],
      });
      expect(isError).toBe(false);
      expect(body).toMatchObject({
        id: privateId,
        private: true,
        text: { content: 'Synthetic zircon payslip of the workshop' },
      });
    });

    it('gives why a document is flagged in its review part', async () => {
      const id = await harness.addDocument([], {
        status: 'needs_review',
        confidence: 0.4,
        core: { reference: 'SYN-1' },
        provenance: {
          reference: { model: 'm', schema_version: null, confidence: 0.4, page: 1, quote: 'SYN-1' },
          '@pipeline': { type: { model: 'm', confidence: 0.9, outcome: 'existing' } },
        },
      });
      const { body } = await callTool(client, 'get_document', { id, include: ['review'] });
      expect(body).toMatchObject({
        review: {
          threshold: 0.7,
          reasons: ['low_confidence'],
          values: [{ name: 'reference', confidence: 0.4, quote: 'SYN-1', doubtful: true }],
        },
      });
    });

    it('answers document_not_found for an unknown id', async () => {
      expect((await failureOf('get_document', { id: 'doc_unknown' })).code).toBe(
        'document_not_found',
      );
    });

    it('gives the status of a document, with the end of its processing log', async () => {
      const { body } = await callTool(client, 'get_status', { id: publicId });
      expect(body).toEqual({
        id: publicId,
        status: 'indexed',
        state: 'current',
        error: null,
        events: [],
      });
      const failing = await harness.addDocument([], { status: 'failed', error: 'no_text' });
      for (let attempt = 1; attempt <= 12; attempt += 1) {
        await harness.database.db.transaction((tx) =>
          recordDocumentEvent(tx, failing, { stage: 'text', outcome: 'retrying', attempt }),
        );
      }
      await harness.database.db.transaction((tx) =>
        recordDocumentEvent(tx, failing, {
          stage: 'text',
          outcome: 'failed',
          status: 'failed',
          errorCode: 'no_text',
          retryable: false,
        }),
      );
      const failed = await callTool(client, 'get_status', { id: failing });
      const { events } = z
        .object({ events: z.array(z.looseObject({ attempt: z.number().nullable() })) })
        .parse(failed.body);
      expect(events.map(({ attempt }) => attempt)).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, null]);
      expect(failed.body).toMatchObject({ status: 'failed', error: 'no_text' });
      expect(events.at(-1)).toMatchObject({
        stage: 'text',
        outcome: 'failed',
        error_code: 'no_text',
        retryable: false,
      });
    });

    it('queues a failed document again and answers its new status', async () => {
      const id = await harness.addDocument([], {
        status: 'failed',
        error: 'model_provider_failed',
      });
      const { isError, body } = await callTool(client, 'retry_document', { id });
      expect(isError).toBe(false);
      expect(body).toEqual({ id, status: 'received', state: 'current', error: null });
    });

    it('refuses to retry a document whose processing did not fail', async () => {
      expect((await failureOf('retry_document', { id: publicId })).code).toBe(
        'document_not_failed',
      );
    });

    it('queues the type of a settled document again and answers its status', async () => {
      const id = await harness.addDocument([], { status: 'needs_review' });
      const { isError, body } = await callTool(client, 'reclassify_document', {
        id,
        hint: 'a payslip',
        new_type: true,
      });
      expect(isError).toBe(false);
      expect(body).toEqual({ id, status: 'needs_review', state: 'current', error: null });
      expect((await failureOf('reclassify_document', { id })).code).toBe('document_not_settled');
    });

    it('refuses to reclassify a document that is not settled', async () => {
      const id = await harness.addDocument([], { status: 'failed', error: 'no_text' });
      expect((await failureOf('reclassify_document', { id })).code).toBe('document_not_settled');
    });
  });

  describe('ingest', () => {
    const file = Buffer.from(syntheticPdf('ingest tool')).toString('base64');

    it('stores a base64 file from MCP, and gives the same document for the same bytes', async () => {
      const first = await callTool(client, 'ingest', {
        file,
        filename: 'note.pdf',
        hint: 'a note',
      });
      const created = z
        .object({ id: z.string(), status: z.string(), duplicate: z.boolean() })
        .parse(first.body);
      expect(created).toMatchObject({ status: 'received', duplicate: false });
      const stored = await callTool(client, 'get_document', { id: created.id });
      expect(stored.body).toMatchObject({ source: 'mcp', hint: 'a note', private: false });
      const again = await callTool(client, 'ingest', { file, filename: 'other.pdf' });
      expect(again.body).toMatchObject({ id: created.id, duplicate: true });
    });

    it('refuses a file larger than the limit with the code of REST', async () => {
      const large = Buffer.alloc(harness.api.maxFileSize + 1, 1).toString('base64');
      const error = await failureOf('ingest', { file: large, filename: 'large.pdf' });
      expect(error).toMatchObject({
        code: 'file_too_large',
        max_file_size: harness.api.maxFileSize,
      });
    });

    it('answers not_implemented for a URL', async () => {
      const error = await failureOf('ingest', { url: 'http://127.0.0.1/a.pdf', filename: 'a.pdf' });
      expect(error.code).toBe('not_implemented');
    });

    it('refuses a call with both a file and a URL, or neither', async () => {
      const both = await client.callTool({
        name: 'ingest',
        arguments: { file, url: 'http://127.0.0.1/a.pdf', filename: 'a.pdf' },
      });
      const neither = await client.callTool({ name: 'ingest', arguments: { filename: 'a.pdf' } });
      expect([both.isError, neither.isError]).toEqual([true, true]);
    });
  });

  describe('describe_types and list_entities', () => {
    it('answers with the registry and the entities', async () => {
      expect((await callTool(client, 'describe_types')).body).toEqual({ types: [] });
      expect((await callTool(client, 'list_entities')).body).toEqual({ entities: [], total: 0 });
    });
  });

  describe('a feature this build does not provide', () => {
    it.each([
      ['update_document', { id: 'doc_x', private: true }],
      ['list_pending_changes', {}],
      ['apply_change', { id: 'chg_x', decision: 'apply' }],
      ['upcoming', { from: '2026-01-01', to: '2026-12-31' }],
      ['timeline', { subject: 'sub_x' }],
      ['recall', { query: 'zircon' }],
      ['get_subject', { query: 'zircon' }],
    ])('answers not_implemented from %s, as REST answers 501', async (name, args) => {
      expect((await failureOf(name, args)).code).toBe('not_implemented');
    });
  });
});

describe('the tools of a bound feature', () => {
  let harness: McpHarness;

  beforeAll(async () => {
    harness = await createMcpHarness();
  });

  afterAll(async () => {
    await harness.dispose();
  });

  it('hand the knowledge layer its input under its own names', async () => {
    const received: unknown[] = [];
    const client = await harness.connect({
      timeline: (input) => {
        received.push(input);
        return Promise.resolve({ items: [], truncated: false });
      },
      getSubject: (input) => {
        received.push(input);
        return Promise.resolve({ found: false, suggestions: [] });
      },
    });
    expect((await callTool(client, 'timeline', { entity: 'ent_x' })).body).toEqual({
      items: [],
      truncated: false,
    });
    await callTool(client, 'get_subject', { id: 'sub_x', as_of: '2026-05-01' });
    expect(received).toEqual([
      { entity: 'ent_x', limit: DEFAULT_TIMELINE_LIMIT, includePrivate: false },
      { id: 'sub_x', asOf: '2026-05-01', includePrivate: false },
    ]);
  });

  it('hands a correction its confirmed values', async () => {
    const received: unknown[] = [];
    const id = await harness.addDocument([]);
    const client = await harness.connect({
      correctDocument: (input) => {
        received.push(input);
        return Promise.resolve({ ok: true });
      },
    });
    const { isError } = await callTool(client, 'update_document', {
      id,
      type: 'note',
      confirm: { reference: 'SYN-1' },
    });
    expect(isError).toBe(false);
    expect(received).toEqual([{ id, type: 'note', confirm: { reference: 'SYN-1' } }]);
  });

  it('answers internal_error for an unexpected failure, reported and never quoted', async () => {
    const client = await harness.connect({
      listChanges: () => Promise.reject(new Error('synthetic secret detail')),
    });
    const { isError, body } = await callTool(client, 'list_pending_changes');
    expect(isError).toBe(true);
    expect(body).toEqual({
      error: { code: 'internal_error', message: 'The server failed to answer this request.' },
    });
    expect(harness.reported.map(({ operation }) => operation)).toEqual(['list_pending_changes']);
  });
});
