import {
  sourceCheckSchema,
  sourceCreateSchema,
  sourceListSchema,
  sourcePatchSchema,
  sourceRunRequestSchema,
  sourceSchema,
} from '@liasse/contract';
import {
  checkSource,
  createSource,
  deleteSource,
  getSource,
  listSources,
  requestSourceRun,
  type SourcesContext,
  updateSource,
} from '@liasse/core/api';
import { Hono, type MiddlewareHandler } from 'hono';
import { failures, jsonResponse, operation, SESSION_SCHEME, valid } from '../describe.ts';
import type { AppEnv } from '../env.ts';
import { jsonBody } from '../guards.ts';
import { idParam } from '../query-params.ts';

const TAG = 'Sources';
const CREDENTIALS = [SESSION_SCHEME];

export interface SourceRouteDeps {
  readonly sources: SourcesContext;
  /**
   * The session of the web UI and nothing else: a source holds credentials, and a leaked
   * API key must not be able to point Liasse at a server of its choosing.
   */
  readonly signedIn: MiddlewareHandler<AppEnv>;
  /** The same, with the deadline of a check, which connects to the source. */
  readonly signedInToCheck: MiddlewareHandler<AppEnv>;
}

export const sourceRoutes = ({
  sources,
  signedIn,
  signedInToCheck,
}: SourceRouteDeps): Hono<AppEnv> =>
  new Hono<AppEnv>()
    .get(
      '/sources',
      operation({
        summary: 'The ingestion sources, secrets replaced by whether each is set',
        tag: TAG,
        credentials: CREDENTIALS,
        responses: { 200: jsonResponse('Oldest first.', sourceListSchema) },
      }),
      signedIn,
      async (context) => context.json(await listSources(sources)),
    )
    .post(
      '/sources',
      operation({
        summary: 'Create an ingestion source; an enabled one runs at once',
        tag: TAG,
        credentials: CREDENTIALS,
        responses: {
          201: jsonResponse('The source as saved.', sourceSchema),
          ...failures(400, 413, 415),
        },
      }),
      signedIn,
      jsonBody,
      valid('json', sourceCreateSchema),
      async (context) => context.json(await createSource(sources, context.req.valid('json')), 201),
    )
    .get(
      '/sources/:id',
      operation({
        summary: 'One ingestion source and its last run',
        tag: TAG,
        credentials: CREDENTIALS,
        responses: { 200: jsonResponse('The source.', sourceSchema), ...failures(404) },
      }),
      signedIn,
      valid('param', idParam),
      async (context) => context.json(await getSource(sources, context.req.valid('param').id)),
    )
    .patch(
      '/sources/:id',
      operation({
        summary: 'Save an ingestion source; an enabled one runs at once',
        tag: TAG,
        credentials: CREDENTIALS,
        responses: {
          200: jsonResponse('The source as saved.', sourceSchema),
          ...failures(400, 404, 413, 415),
        },
      }),
      signedIn,
      valid('param', idParam),
      jsonBody,
      valid('json', sourcePatchSchema),
      async (context) =>
        context.json(
          await updateSource(sources, context.req.valid('param').id, context.req.valid('json')),
        ),
    )
    .delete(
      '/sources/:id',
      operation({
        summary: 'Delete an ingestion source; its documents stay',
        tag: TAG,
        credentials: CREDENTIALS,
        responses: { 204: { description: 'Deleted.' }, ...failures(404) },
      }),
      signedIn,
      valid('param', idParam),
      async (context) => {
        await deleteSource(sources, context.req.valid('param').id);
        return context.body(null, 204);
      },
    )
    .post(
      '/sources/:id/check',
      operation({
        summary: 'Connect with the stored credentials and list what the next run would take',
        tag: TAG,
        credentials: CREDENTIALS,
        responses: {
          200: jsonResponse('What the source answered.', sourceCheckSchema),
          ...failures(404),
        },
      }),
      signedInToCheck,
      valid('param', idParam),
      async (context) => context.json(await checkSource(sources, context.req.valid('param').id)),
    )
    .post(
      '/sources/:id/run',
      operation({
        summary: 'Run an ingestion source now',
        tag: TAG,
        credentials: CREDENTIALS,
        responses: {
          202: jsonResponse('Whether a run was queued.', sourceRunRequestSchema),
          ...failures(404, 409),
        },
      }),
      signedIn,
      valid('param', idParam),
      async (context) =>
        context.json(await requestSourceRun(sources, context.req.valid('param').id), 202),
    );
