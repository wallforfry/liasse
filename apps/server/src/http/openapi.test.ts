import { Validator } from '@seriousme/openapi-schema-validator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createHttpHarness, type HttpHarness } from './harness.test-helper.ts';

const documentSchema = z.looseObject({
  openapi: z.string(),
  paths: z.record(z.string(), z.record(z.string(), z.looseObject({}))),
  components: z.looseObject({ securitySchemes: z.record(z.string(), z.unknown()) }),
});

// `/documents/:id` in Hono is `/documents/{id}` in OpenAPI.
const openApiPath = (path: string): string => path.replaceAll(/:([A-Za-z]+)/g, '{$1}');

describe('GET /openapi.json', () => {
  let harness: HttpHarness;
  let raw: unknown;

  beforeAll(async () => {
    harness = await createHttpHarness();
    raw = await (await harness.call('/openapi.json')).json();
  });

  afterAll(async () => {
    await harness.dispose();
  });

  it('is a valid OpenAPI 3.1 document', async () => {
    const validator = new Validator();
    const result = await validator.validate(z.record(z.string(), z.unknown()).parse(raw));
    expect(result.errors ?? []).toEqual([]);
    expect(result.valid).toBe(true);
    expect(validator.version).toBe('3.1');
  });

  it('describes every route the application registers, and no other', () => {
    const registered = harness.app.routes
      .filter(({ method }) => method !== 'ALL')
      .map(({ method, path }) => `${method} ${openApiPath(path)}`);
    const { paths } = documentSchema.parse(raw);
    const described = Object.entries(paths).flatMap(([path, operations]) =>
      Object.keys(operations).map((method) => `${method.toUpperCase()} ${path}`),
    );
    expect(new Set(registered).size).toBeGreaterThanOrEqual(17);
    expect(described.toSorted()).toEqual([...new Set(registered)].toSorted());
  });

  it('documents request bodies and parameters from the schemas that validate them', () => {
    const { paths } = documentSchema.parse(raw);
    const text = JSON.stringify(paths);
    expect(JSON.stringify(paths['/search']?.post)).toContain('include_private');
    expect(JSON.stringify(paths['/query']?.post)).toContain('group_by');
    expect(JSON.stringify(paths['/documents']?.post)).toContain('multipart/form-data');
    expect(JSON.stringify(paths['/documents/{id}']?.get)).toContain('text_offset');
    expect(text).not.toContain('storage_key');
  });

  it('documents the answers of the knowledge routes from the schemas that define them', () => {
    const { paths } = documentSchema.parse(raw);
    const answer = (path: string) => JSON.stringify(paths[path]?.get?.responses);
    expect(answer('/subjects')).toContain('documentCount');
    expect(answer('/upcoming')).toContain('notice_deadline');
    expect(answer('/subjects')).toContain('truncated');
  });

  it('declares the two credentials and marks /health alone as public', () => {
    const { paths, components } = documentSchema.parse(raw);
    expect(Object.keys(components.securitySchemes).toSorted()).toEqual(['bearerAuth', 'signedUrl']);
    const open = Object.entries(paths).flatMap(([path, operations]) =>
      Object.entries(operations)
        .filter(([, operation]) => JSON.stringify(operation.security ?? []) === '[]')
        .map(([method]) => `${method} ${path}`),
    );
    expect(open).toEqual(['get /health']);
  });
});
