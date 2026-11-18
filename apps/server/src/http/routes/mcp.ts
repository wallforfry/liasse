import { handleMcpRequest, mcpMessageSizeLimit, type ReportFailure } from '@liasse/mcp';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import { failures, operation } from '../describe.ts';
import type { AppContext, AppEnv } from '../env.ts';
import { failure, HttpFailure, respondWith } from '../errors.ts';
import { jsonDepth, requireMediaType } from '../guards.ts';
import type { RouteDeps } from './deps.ts';

export interface McpRouteDeps extends RouteDeps {
  readonly report: ReportFailure;
}

const TAG = 'MCP';
const PATH = '/mcp';

const REQUEST_BODY = {
  required: true,
  content: { 'application/json': { schema: { type: 'object', description: 'JSON-RPC 2.0.' } } },
} as const;

// The server keeps no session, so it opens no stream of its own and has none to end: the
// protocol answers both methods with 405.
const notAllowed = (context: AppContext): Response => {
  context.header('Allow', 'POST');
  return respondWith(
    context,
    failure('method_not_allowed', 'This server takes MCP messages by POST only.'),
  );
};

const NOT_ALLOWED_OPERATION = operation({
  summary: 'Not served: MCP over Streamable HTTP is stateless here',
  tag: TAG,
  responses: failures(405),
});

/** MCP over Streamable HTTP, behind the credentials of the API. */
export const mcpRoutes = ({ authenticated, report }: McpRouteDeps): Hono<AppEnv> =>
  new Hono<AppEnv>()
    .post(
      PATH,
      operation({
        summary: 'MCP over Streamable HTTP (stateless, answered as JSON)',
        tag: TAG,
        requestBody: REQUEST_BODY,
        responses: {
          200: { description: 'The JSON-RPC response.' },
          202: { description: 'A notification, accepted.' },
          ...failures(400, 413, 415),
        },
      }),
      authenticated,
      requireMediaType(['application/json']),
      (context, next) =>
        bodyLimit({
          maxSize: mcpMessageSizeLimit(context.var.api.maxFileSize),
          onError: () => {
            throw new HTTPException(413);
          },
        })(context, next),
      jsonDepth,
      async (context) => {
        const body: unknown = await context.req.json().catch(() => {
          throw new HttpFailure(failure('invalid_body', 'The request body is not JSON.'));
        });
        return handleMcpRequest({ api: () => context.var.api, report }, context.req.raw, body);
      },
    )
    .get(PATH, NOT_ALLOWED_OPERATION, authenticated, notAllowed)
    .delete(PATH, NOT_ALLOWED_OPERATION, authenticated, notAllowed);
