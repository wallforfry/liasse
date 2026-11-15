import {
  documentCorrectionSchema,
  documentEventListSchema,
  documentListSchema,
  documentSchema,
  getDocumentOptionsSchema,
  listDocumentsOptionsSchema,
} from '@liasse/contract';
import {
  correctDocument,
  CORRECTED_PARTS,
  getDocument,
  listDocumentEvents,
  listDocuments,
  removeDocument,
} from '@liasse/core/api';
import { Hono } from 'hono';
import { z } from 'zod';
import { failures, jsonResponse, operation, valid } from '../describe.ts';
import type { AppEnv } from '../env.ts';
import { jsonBody } from '../guards.ts';
import { idParam, integerParam, listParam } from '../query-params.ts';
import type { RouteDeps } from './deps.ts';

const TAG = 'Documents';

const listQuery = z
  .strictObject({
    status: z.string().optional(),
    type: z.string().optional(),
    private: z.string().optional(),
    limit: integerParam.optional(),
    offset: integerParam.optional(),
  })
  .pipe(listDocumentsOptionsSchema);

const documentQuery = z
  .strictObject({
    include: listParam.optional().describe('Comma-separated parts.'),
    text_offset: integerParam.optional(),
    text_limit: integerParam.optional(),
    page_from: integerParam.optional(),
    page_limit: integerParam.optional(),
  })
  .pipe(getDocumentOptionsSchema);

export const documentRoutes = ({ api, authenticated }: RouteDeps): Hono<AppEnv> =>
  new Hono<AppEnv>()
    .get(
      '/documents',
      operation({
        summary: 'List documents, most recent first',
        tag: TAG,
        responses: {
          200: jsonResponse('A page of documents.', documentListSchema),
          ...failures(400),
        },
      }),
      authenticated,
      valid('query', listQuery),
      async (context) => context.json(await listDocuments(api, context.req.valid('query'))),
    )
    .get(
      '/documents/:id',
      operation({
        summary: 'Read a document, with the parts asked for',
        tag: TAG,
        responses: { 200: jsonResponse('The document.', documentSchema), ...failures(400, 404) },
      }),
      authenticated,
      valid('param', idParam),
      valid('query', documentQuery),
      async (context) =>
        context.json(
          await getDocument(api, context.req.valid('param').id, context.req.valid('query')),
        ),
    )
    .get(
      '/documents/:id/events',
      operation({
        summary: 'Read the processing log of a document, oldest first',
        tag: TAG,
        responses: {
          200: jsonResponse('The most recent events of its processing.', documentEventListSchema),
          ...failures(400, 404),
        },
      }),
      authenticated,
      valid('param', idParam),
      async (context) => context.json(await listDocumentEvents(api, context.req.valid('param').id)),
    )
    .patch(
      '/documents/:id',
      operation({
        summary: 'Correct a document',
        tag: TAG,
        responses: {
          200: jsonResponse('The corrected document.', documentSchema),
          ...failures(400, 404, 413, 415, 501),
        },
      }),
      authenticated,
      jsonBody,
      valid('param', idParam),
      valid('json', documentCorrectionSchema),
      async (context) => {
        const { id } = context.req.valid('param');
        await correctDocument(api, id, context.req.valid('json'));
        return context.json(await getDocument(api, id, { include: [...CORRECTED_PARTS] }));
      },
    )
    .delete(
      '/documents/:id',
      operation({
        summary: 'Delete a document and its file',
        tag: TAG,
        responses: { 204: { description: 'Deleted.' }, ...failures(404) },
      }),
      authenticated,
      valid('param', idParam),
      async (context) => {
        await removeDocument(api, context.req.valid('param').id);
        return context.body(null, 204);
      },
    );
