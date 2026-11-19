import { flaggedReclassificationSchema } from '@liasse/contract';
import { reclassifyFlaggedDocuments } from '@liasse/core/api';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpDeps } from '../deps.ts';
import { toolAnswer } from '../outcome.ts';

const RECLASSIFY_FLAGGED_DESCRIPTION =
  'Decides again, in one call, the type of the documents flagged `needs_review` for how ' +
  'their type was decided: `reason` `type_untyped` for those left without a type, ' +
  '`type_fallback` for those given the closest type. Each is queued as ' +
  '`reclassify_document` would queue it, oldest first, at most `limit`, private ones ' +
  'included. A document with a processing, re-extraction or reclassification pending is ' +
  'skipped, not refused; one whose last reclassification met a type refusal is left out ' +
  '(`refused`): use `reclassify_document` for it. With `type_fallback` the closest type ' +
  'is rejected for each. Returns the counts `queued`, `skipped`, `refused` and ' +
  '`remaining` (left beyond `limit`: call again). `list_documents` with ' +
  '`status: needs_review` lists the ' +
  'documents flagged for review.';

export const registerFlaggedReclassificationTool = (
  server: McpServer,
  { api, report }: McpDeps,
): void => {
  server.registerTool(
    'reclassify_flagged_documents',
    {
      description: RECLASSIFY_FLAGGED_DESCRIPTION,
      inputSchema: flaggedReclassificationSchema,
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (request) =>
      toolAnswer('reclassify_flagged_documents', report, () =>
        reclassifyFlaggedDocuments(api(), request),
      ),
  );
};
