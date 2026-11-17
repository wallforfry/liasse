import { z } from 'zod';
import { DEFAULT_GRAPH_DOCUMENT_LIMIT, MAX_GRAPH_DOCUMENT_LIMIT } from './domain/limits.ts';
import {
  documentStateSchema,
  entityKindSchema,
  graphEdgeKindSchema,
  liveDocumentStatusSchema,
  subjectKindSchema,
  typeStatusSchema,
} from './domain/schemas.ts';
import { untrustedText } from './knowledge.ts';

export const graphRequestSchema = z.strictObject({
  limit: z
    .int()
    .min(1)
    .max(MAX_GRAPH_DOCUMENT_LIMIT)
    .default(DEFAULT_GRAPH_DOCUMENT_LIMIT)
    .describe('The most recent documents the graph is drawn from.'),
  include_private: z.boolean().default(false),
});
export type GraphRequest = z.input<typeof graphRequestSchema>;

const documentNodeSchema = z.strictObject({
  kind: z.literal('document'),
  id: z.string(),
  label: untrustedText.describe('The title, or the file name until there is one.'),
  status: liveDocumentStatusSchema,
  state: documentStateSchema,
  private: z.boolean(),
});

const typeNodeSchema = z.strictObject({
  kind: z.literal('type'),
  id: z.string(),
  label: z.string().describe('The slug of the type.'),
  status: typeStatusSchema,
});

const subjectNodeSchema = z.strictObject({
  kind: z.literal('subject'),
  id: z.string(),
  label: untrustedText,
  subject_kind: subjectKindSchema,
});

const entityNodeSchema = z.strictObject({
  kind: z.literal('entity'),
  id: z.string(),
  label: untrustedText,
  entity_kind: entityKindSchema,
});

export const graphNodeSchema = z.discriminatedUnion('kind', [
  documentNodeSchema,
  typeNodeSchema,
  subjectNodeSchema,
  entityNodeSchema,
]);
export type GraphNode = z.output<typeof graphNodeSchema>;

export const graphEdgeSchema = z.strictObject({
  source: z.string().describe('The id of a node: the document, or the type under its parent.'),
  target: z.string(),
  kind: graphEdgeKindSchema,
});
export type GraphEdge = z.output<typeof graphEdgeSchema>;

// Every edge joins two nodes of the answer: a link to a document left out by the limit
// is left out with it.
export const graphSchema = z.strictObject({
  nodes: z.array(graphNodeSchema),
  edges: z.array(graphEdgeSchema),
  document_total: z.int().describe('Live documents the graph could show, the limit aside.'),
});
export type Graph = z.output<typeof graphSchema>;
