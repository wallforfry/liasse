import { errorBodySchema } from '@liasse/contract';
import { describeRoute, type DescribeRouteOptions, resolver, validator } from 'hono-openapi';
import type { ValidationTargets } from 'hono';
import type { z } from 'zod';
import type { AppEnv } from './env.ts';
import { HttpFailure, invalidRequest } from './errors.ts';

export const BEARER_SCHEME = 'bearerAuth';
export const SIGNED_URL_SCHEME = 'signedUrl';
export const SESSION_SCHEME = 'sessionCookie';

type Responses = NonNullable<DescribeRouteOptions['responses']>;

export const jsonResponse = (description: string, schema: z.ZodType): Responses[string] => ({
  description,
  content: { 'application/json': { schema: resolver(schema) } },
});

const FAILURES: Readonly<Record<number, string>> = {
  400: 'The request is not valid.',
  401: 'No valid credential.',
  404: 'Not found.',
  405: 'The route does not serve this method.',
  409: 'The request conflicts with the current state.',
  413: 'The body is too large.',
  415: 'The body has an unsupported media type or format.',
  501: 'This server does not provide the feature yet.',
  503: 'The database could not answer.',
  504: 'The request or the query took too long.',
};

export const failures = (...statuses: readonly number[]): Responses =>
  Object.fromEntries(
    statuses.map((status) => [
      String(status),
      jsonResponse(FAILURES[status] ?? 'Failure.', errorBodySchema),
    ]),
  );

interface Operation {
  readonly summary: string;
  readonly tag: string;
  readonly responses: Responses;
  /** For a body no validator reads as a whole: a file, or a query the DSL parses itself. */
  readonly requestBody?: DescribeRouteOptions['requestBody'];
  /** Bearer token only, unless said otherwise. An empty list is a public route. */
  readonly credentials?: readonly string[];
}

/** The OpenAPI operation of a route. Every route has one: a test compares the two lists. */
export const operation = ({
  summary,
  tag,
  responses,
  requestBody,
  credentials = [BEARER_SCHEME],
}: Operation) =>
  describeRoute({
    summary,
    tags: [tag],
    security: credentials.map((scheme) => ({ [scheme]: [] })),
    ...(requestBody === undefined ? {} : { requestBody }),
    responses: {
      ...responses,
      ...(credentials.length === 0 ? {} : failures(401)),
    },
  });

/**
 * Validates one part of the request with the schema that documents it. A refusal names
 * where the problem is, never the value that was sent.
 */
export const valid = <Target extends keyof ValidationTargets, Schema extends z.ZodType>(
  target: Target,
  schema: Schema,
): ReturnType<typeof validator<Schema, Target, AppEnv, string>> =>
  validator<Schema, Target, AppEnv, string>(target, schema, (result) => {
    if (result.success) return;
    throw new HttpFailure(
      invalidRequest(
        result.error.map(({ path = [], message }) => ({
          path: path.map((segment) => (typeof segment === 'object' ? segment.key : segment)),
          message,
        })),
      ),
    );
  });
