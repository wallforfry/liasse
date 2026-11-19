import {
  documentCorrectionSchema,
  documentEventListSchema,
  documentListSchema,
  documentReclassificationSchema,
  documentSchema,
  documentStatusSchema,
  flaggedReclassificationResultSchema,
  flaggedReclassificationSchema,
  getDocumentOptionsSchema,
  listDocumentsOptionsSchema,
} from '@liasse/contract';
import {
  correctDocument,
  CORRECTED_PARTS,
  getDocument,
  getDocumentStatus,
  listDocumentEvents,
  listDocuments,
  reclassifyDocument,
  reclassifyFlaggedDocuments,
  reextractDocument,
  removeDocument,
  retryDocument,
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
    entity: z.string().optional(),
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

export const documentRoutes = ({ authenticated }: RouteDeps): Hono<AppEnv> =>
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
      async (context) =>
        context.json(await listDocuments(context.var.api, context.req.valid('query'))),
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
          await getDocument(
            context.var.api,
            context.req.valid('param').id,
            context.req.valid('query'),
          ),
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
      async (context) =>
        context.json(await listDocumentEvents(context.var.api, context.req.valid('param').id)),
    )
    .get(
      '/documents/:id/status',
      operation({
        summary: 'Read where the processing of a document stands',
        tag: TAG,
        responses: {
          200: jsonResponse(
            'Its status, the end of its processing log and the job that takes it further.',
            documentStatusSchema,
          ),
          ...failures(400, 404),
        },
      }),
      authenticated,
      valid('param', idParam),
      async (context) =>
        context.json(await getDocumentStatus(context.var.api, context.req.valid('param').id)),
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
        await correctDocument(context.var.api, id, context.req.valid('json'));
        return context.json(
          await getDocument(context.var.api, id, { include: [...CORRECTED_PARTS] }),
        );
      },
    )
    .post(
      '/documents/:id/retry',
      operation({
        summary: 'Process a failed document again',
        tag: TAG,
        responses: {
          202: jsonResponse('The document, queued for processing.', documentSchema),
          ...failures(400, 404),
        },
      }),
      authenticated,
      valid('param', idParam),
      async (context) => {
        const { id } = context.req.valid('param');
        await retryDocument(context.var.api, id);
        return context.json(await getDocument(context.var.api, id), 202);
      },
    )
    .post(
      '/documents/:id/reclassify',
      operation({
        summary: 'Decide the type of a settled document again, without any type rejected for it',
        tag: TAG,
        responses: {
          202: jsonResponse('The document, queued for its type.', documentSchema),
          ...failures(400, 404, 413, 415),
        },
      }),
      authenticated,
      jsonBody,
      valid('param', idParam),
      valid('json', documentReclassificationSchema),
      async (context) => {
        const { id } = context.req.valid('param');
        await reclassifyDocument(context.var.api, id, context.req.valid('json'));
        return context.json(await getDocument(context.var.api, id), 202);
      },
    )
    .post(
      '/documents/reclassify',
      operation({
        summary: 'Decide again the type of the documents flagged for review with a type reason',
        tag: TAG,
        responses: {
          202: jsonResponse(
            'What was queued, skipped and left.',
            flaggedReclassificationResultSchema,
          ),
          ...failures(400, 413, 415),
        },
      }),
      authenticated,
      jsonBody,
      valid('json', flaggedReclassificationSchema),
      async (context) =>
        context.json(
          await reclassifyFlaggedDocuments(context.var.api, context.req.valid('json')),
          202,
        ),
    )
    .post(
      '/documents/:id/reextract',
      operation({
        summary: 'Extract the values of a settled document again, for the type it has',
        tag: TAG,
        responses: {
          202: jsonResponse('The document, queued for its values.', documentSchema),
          ...failures(400, 404),
        },
      }),
      authenticated,
      valid('param', idParam),
      async (context) => {
        const { id } = context.req.valid('param');
        await reextractDocument(context.var.api, id);
        return context.json(await getDocument(context.var.api, id), 202);
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
        await removeDocument(context.var.api, context.req.valid('param').id);
        return context.body(null, 204);
      },
    );
