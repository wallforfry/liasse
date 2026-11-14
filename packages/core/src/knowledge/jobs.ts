import { z } from 'zod';
import { handle, type RegisteredHandler } from '../jobs/handlers.ts';
import { defineJobKind } from '../jobs/kinds.ts';
import { detectLinks, type DetectLinksDeps } from './detect-links.ts';

/**
 * Queued once a document is indexed, and again after each re-extraction: the third text
 * call of a document. Detection replaces what it wrote before, so the job may run any
 * number of times, and a document deleted meanwhile is left alone.
 */
export const detectLinksJob = defineJobKind({
  name: 'detect_links',
  schema: z.object({ documentId: z.string().min(1) }),
});

// The job handlers of the knowledge layer, for `startWorkers`.
export const createKnowledgeHandlers = (deps: DetectLinksDeps): readonly RegisteredHandler[] => [
  handle(detectLinksJob, async ({ payload, signal }) => {
    await detectLinks(deps, payload.documentId, signal);
  }),
];
