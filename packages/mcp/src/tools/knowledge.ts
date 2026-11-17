import {
  getSubjectOptionsSchema,
  recallOptionsSchema,
  timelineOptionsSchema,
  upcomingOptionsSchema,
} from '@liasse/contract';
import { keyDateKindSchema, subjectKindSchema } from '@liasse/contract/domain';
import { getSubject, recall, timeline, upcoming } from '@liasse/core/api';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { type McpDeps, UNTRUSTED } from '../deps.ts';
import { toolAnswer } from '../outcome.ts';

const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;

const PRIVATE_NOTE = 'Private documents are left out unless `include_private` is true.';

const UPCOMING_DESCRIPTION =
  `Key dates between \`from\` and \`to\` (${keyDateKindSchema.options.join(', ')}), sorted, ` +
  'each with its label, document, subject and state. By default the dates of a superseded ' +
  `or terminated document are left out (\`current_only\`). ${PRIVATE_NOTE} ${UNTRUSTED}`;

const TIMELINE_DESCRIPTION =
  'Chronology of a subject or an entity, given by its id (`subject` or `entity`, one of ' +
  'the two): its dated facts and documents in order, within `from` and `to` when given. ' +
  `${PRIVATE_NOTE} ${UNTRUSTED}`;

const RECALL_DESCRIPTION =
  'Fact search, memory-style: the facts read in the documents that match `query`, with ' +
  'their validity and source document, and the facts related to them. `at` keeps the ' +
  `facts valid on that day. ${PRIVATE_NOTE} ${UNTRUSTED}`;

const GET_SUBJECT_DESCRIPTION =
  `A subject (${subjectKindSchema.options.join(', ')}) by its \`id\`, or by words ` +
  'that name it (`query`): its linked documents, current state and next key dates. A ' +
  `query that names none or several answers with suggestions. ${PRIVATE_NOTE} ${UNTRUSTED}`;

export const registerKnowledgeTools = (server: McpServer, { api, report }: McpDeps): void => {
  server.registerTool(
    'upcoming',
    {
      description: UPCOMING_DESCRIPTION,
      inputSchema: upcomingOptionsSchema,
      annotations: READ_ONLY,
    },
    async (options) => toolAnswer('upcoming', report, () => upcoming(api(), options)),
  );
  server.registerTool(
    'timeline',
    {
      description: TIMELINE_DESCRIPTION,
      inputSchema: timelineOptionsSchema,
      annotations: READ_ONLY,
    },
    async (options) => toolAnswer('timeline', report, () => timeline(api(), options)),
  );
  server.registerTool(
    'recall',
    { description: RECALL_DESCRIPTION, inputSchema: recallOptionsSchema, annotations: READ_ONLY },
    async (options) => toolAnswer('recall', report, () => recall(api(), options)),
  );
  server.registerTool(
    'get_subject',
    {
      description: GET_SUBJECT_DESCRIPTION,
      inputSchema: getSubjectOptionsSchema,
      annotations: READ_ONLY,
    },
    async (options) => toolAnswer('get_subject', report, () => getSubject(api(), options)),
  );
};
