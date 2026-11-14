import {
  queryDocuments,
  queryResultSchema,
  searchDocuments,
  searchRequestSchema,
  searchResultsSchema,
} from '@liasse/core/api';
import { queryDslSchema } from '@liasse/core/query';
import { Hono } from 'hono';
import { resolver } from 'hono-openapi';
import { failures, jsonResponse, operation, valid } from '../describe.ts';
import type { AppEnv } from '../env.ts';
import { failure, HttpFailure } from '../errors.ts';
import { jsonBody } from '../guards.ts';
import type { RouteDeps } from './deps.ts';

const TAG = 'Search';

export const searchRoutes = ({ api, authenticated }: RouteDeps): Hono<AppEnv> =>
  new Hono<AppEnv>()
    .post(
      '/search',
      operation({
        summary: 'Hybrid natural-language search',
        tag: TAG,
        responses: {
          200: jsonResponse('Documents with the snippets that matched.', searchResultsSchema),
          ...failures(400, 413, 415),
        },
      }),
      authenticated,
      jsonBody,
      valid('json', searchRequestSchema),
      async (context) => context.json(await searchDocuments(api, context.req.valid('json'))),
    )
    .post(
      '/query',
      operation({
        summary: 'Structured query (DSL)',
        tag: TAG,
        // The DSL parses the body itself: its errors say which field or operator to
        // correct, which a generic validation failure would not.
        requestBody: {
          required: true,
          content: { 'application/json': { schema: resolver(queryDslSchema) } },
        },
        responses: {
          200: jsonResponse('Rows, or the groups of an aggregate.', queryResultSchema),
          ...failures(400, 413, 415, 503, 504),
        },
      }),
      authenticated,
      jsonBody,
      async (context) => {
        const body: unknown = await context.req.json().catch(() => {
          throw new HttpFailure(failure(400, 'invalid_body', 'The request body is not JSON.'));
        });
        return context.json(await queryDocuments(api, body));
      },
    );
