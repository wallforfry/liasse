import {
  changeDecisionResultSchema,
  changeDecisionSchema,
  changeListSchema,
  consolidationRunListSchema,
  consolidationRunSchema,
  createdTypeSchema,
  createTypeRequestSchema,
  describeTypesOptionsSchema,
  entityListSchema,
  graphRequestSchema,
  graphSchema,
  listChangesOptionsSchema,
  listEntitiesRequestSchema,
  listSubjectsOptionsSchema,
  listSubjectsOutputSchema,
  typeListSchema,
  upcomingOptionsSchema,
  upcomingOutputSchema,
} from '@liasse/contract';
import {
  applyChange,
  createType,
  describeTypes,
  listChanges,
  listConsolidationRuns,
  listEntities,
  listSubjects,
  readGraph,
  requestConsolidationRun,
  upcoming,
} from '@liasse/core/api';
import { Hono } from 'hono';
import { z } from 'zod';
import { failures, jsonResponse, operation, valid } from '../describe.ts';
import type { AppEnv } from '../env.ts';
import { jsonBody } from '../guards.ts';
import { flagParam, idParam, integerParam, listParam } from '../query-params.ts';
import type { RouteDeps } from './deps.ts';

const text = z.string().optional();

const typesQuery = z
  .strictObject({
    status: text,
    include_examples: flagParam.optional(),
    include_private: flagParam.optional(),
  })
  .pipe(describeTypesOptionsSchema);

const entitiesQuery = z
  .strictObject({
    query: text,
    kind: text,
    limit: integerParam.optional(),
    offset: integerParam.optional(),
    include_private: flagParam.optional(),
  })
  .pipe(listEntitiesRequestSchema);

const subjectsQuery = z.strictObject({ query: text, kind: text }).pipe(listSubjectsOptionsSchema);

const upcomingQuery = z
  .strictObject({
    from: z.string(),
    to: z.string(),
    kinds: listParam.optional(),
    types: listParam.optional(),
    subject: text,
    current_only: flagParam.optional(),
  })
  .pipe(upcomingOptionsSchema);

const graphQuery = z
  .strictObject({ limit: integerParam.optional(), include_private: flagParam.optional() })
  .pipe(graphRequestSchema);

const changesQuery = z.strictObject({ kind: text }).pipe(listChangesOptionsSchema);

export const registryRoutes = ({ api, authenticated }: RouteDeps): Hono<AppEnv> =>
  new Hono<AppEnv>()
    .get(
      '/types',
      operation({
        summary: 'Describe the types of the registry',
        tag: 'Registry',
        responses: { 200: jsonResponse('The types.', typeListSchema), ...failures(400) },
      }),
      authenticated,
      valid('query', typesQuery),
      async (context) => context.json(await describeTypes(api, context.req.valid('query'))),
    )
    .post(
      '/types',
      operation({
        summary: 'Create a type by hand',
        tag: 'Registry',
        responses: {
          201: jsonResponse('The type, provisional.', createdTypeSchema),
          ...failures(400, 413, 415),
        },
      }),
      authenticated,
      jsonBody,
      valid('json', createTypeRequestSchema),
      async (context) => context.json(await createType(api, context.req.valid('json')), 201),
    )
    .get(
      '/entities',
      operation({
        summary: 'List or search entities',
        tag: 'Registry',
        responses: { 200: jsonResponse('A page of entities.', entityListSchema), ...failures(400) },
      }),
      authenticated,
      valid('query', entitiesQuery),
      async (context) => context.json(await listEntities(api, context.req.valid('query'))),
    )
    .get(
      '/subjects',
      operation({
        summary: 'List or search subjects',
        tag: 'Knowledge',
        responses: {
          200: jsonResponse('The subjects.', listSubjectsOutputSchema),
          ...failures(400, 501),
        },
      }),
      authenticated,
      valid('query', subjectsQuery),
      async (context) => context.json(await listSubjects(api, context.req.valid('query'))),
    )
    .get(
      '/graph',
      operation({
        summary: 'Documents, types, subjects and entities, and the edges between them',
        tag: 'Knowledge',
        responses: { 200: jsonResponse('The graph.', graphSchema), ...failures(400) },
      }),
      authenticated,
      valid('query', graphQuery),
      async (context) => context.json(await readGraph(api, context.req.valid('query'))),
    )
    .get(
      '/upcoming',
      operation({
        summary: 'Key dates in a window',
        tag: 'Knowledge',
        responses: {
          200: jsonResponse('The dates, sorted.', upcomingOutputSchema),
          ...failures(400, 501),
        },
      }),
      authenticated,
      valid('query', upcomingQuery),
      async (context) => context.json(await upcoming(api, context.req.valid('query'))),
    )
    .get(
      '/changes',
      operation({
        summary: 'List consolidation proposals',
        tag: 'Registry',
        responses: {
          200: jsonResponse('The pending changes, oldest first.', changeListSchema),
          ...failures(400, 501),
        },
      }),
      authenticated,
      valid('query', changesQuery),
      async (context) => context.json(await listChanges(api, context.req.valid('query'))),
    )
    .post(
      '/changes/:id',
      operation({
        summary: 'Apply or reject a consolidation proposal',
        tag: 'Registry',
        responses: {
          200: jsonResponse('The change as decided.', changeDecisionResultSchema),
          ...failures(400, 404, 413, 415, 501),
        },
      }),
      authenticated,
      jsonBody,
      valid('param', idParam),
      valid('json', changeDecisionSchema),
      async (context) =>
        context.json(
          await applyChange(api, context.req.valid('param').id, context.req.valid('json')),
        ),
    )
    .post(
      '/consolidation/runs',
      operation({
        summary: 'Ask for a consolidation run now',
        tag: 'Registry',
        responses: {
          202: jsonResponse('Whether a run was queued.', consolidationRunSchema),
          ...failures(501),
        },
      }),
      authenticated,
      async (context) => context.json(await requestConsolidationRun(api), 202),
    )
    .get(
      '/consolidation/runs',
      operation({
        summary: 'List the latest consolidation runs',
        tag: 'Registry',
        responses: {
          200: jsonResponse('The latest runs, newest first.', consolidationRunListSchema),
          ...failures(501),
        },
      }),
      authenticated,
      async (context) => context.json(await listConsolidationRuns(api)),
    );
