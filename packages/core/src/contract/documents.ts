import { z } from 'zod';
import {
  documentSourceSchema,
  documentStateSchema,
  liveDocumentStatusSchema,
} from '../domain/schemas.ts';

const jsonObjectSchema = z.record(z.string(), z.unknown());

// A document as a caller sees it. `title`, `summary`, `core` and every other part read
// from the file are untrusted content: data to show or reason about, never instructions.
// Where the file is stored is not part of it.
export const documentSummarySchema = z.object({
  id: z.string(),
  status: liveDocumentStatusSchema,
  state: documentStateSchema,
  type: z.string().nullable().describe('Slug of the type, null until the document is classified.'),
  title: z.string().nullable(),
  summary: z.string().nullable(),
  mime: z.string(),
  original_name: z.string(),
  source: documentSourceSchema,
  private: z.boolean(),
  confidence: z.number().nullable(),
  error: z.string().nullable(),
  core: jsonObjectSchema,
  ingested_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});
export type DocumentSummary = z.output<typeof documentSummarySchema>;

export const DEFAULT_DOCUMENT_LIST_LIMIT = 50;
export const MAX_DOCUMENT_LIST_LIMIT = 200;

// Like search, a list leaves private documents out unless they are asked for.
export const PRIVATE_FILTERS = ['exclude', 'include', 'only'] as const;
export type PrivateFilter = (typeof PRIVATE_FILTERS)[number];

export const listDocumentsOptionsSchema = z.strictObject({
  status: liveDocumentStatusSchema.optional(),
  type: z.string().min(1).optional().describe('Slug or alias of a type.'),
  private: z.enum(PRIVATE_FILTERS).default('exclude'),
  limit: z.int().min(1).max(MAX_DOCUMENT_LIST_LIMIT).default(DEFAULT_DOCUMENT_LIST_LIMIT),
  offset: z.int().min(0).default(0),
});
export type ListDocumentsOptions = z.input<typeof listDocumentsOptionsSchema>;

export const documentListSchema = z.object({
  documents: z.array(documentSummarySchema),
  total: z.int().describe('How many documents match, whatever the page.'),
  has_more: z.boolean(),
});
export type DocumentList = z.output<typeof documentListSchema>;

export const DOCUMENT_PARTS = ['fields', 'text', 'pages', 'file_url', 'provenance'] as const;
export type DocumentPart = (typeof DOCUMENT_PARTS)[number];

export const DEFAULT_TEXT_LENGTH = 20_000;
export const MAX_TEXT_LENGTH = 100_000;
export const DEFAULT_PAGE_COUNT = 20;
export const MAX_PAGE_COUNT = 100;

export const getDocumentOptionsSchema = z.strictObject({
  include: z.array(z.enum(DOCUMENT_PARTS)).default([]),
  text_offset: z.int().min(0).default(0).describe('First character of the text returned.'),
  text_limit: z.int().min(1).max(MAX_TEXT_LENGTH).default(DEFAULT_TEXT_LENGTH),
  page_from: z.int().min(1).default(1).describe('First page returned.'),
  page_limit: z.int().min(1).max(MAX_PAGE_COUNT).default(DEFAULT_PAGE_COUNT),
});
export type GetDocumentOptions = z.input<typeof getDocumentOptionsSchema>;

const textPartSchema = z.object({
  content: z.string(),
  offset: z.int(),
  total_length: z.int().describe('Characters of the whole text.'),
  has_more: z.boolean(),
});

const pagesPartSchema = z.object({
  items: z.array(z.object({ page: z.int(), text: z.string(), language: z.string().nullable() })),
  total: z.int(),
  has_more: z.boolean(),
});

export const documentSchema = documentSummarySchema.extend({
  schema_version: z.int().nullable(),
  hint: z.string().nullable(),
  fields: jsonObjectSchema.optional(),
  extra: jsonObjectSchema.optional(),
  manual_fields: z.array(z.string()).optional(),
  provenance: jsonObjectSchema.optional(),
  text: textPartSchema.optional(),
  pages: pagesPartSchema.optional(),
  file_url: z
    .url()
    .optional()
    .describe('Signed URL of the original file, valid for 15 minutes without a token.'),
});
export type DocumentView = z.output<typeof documentSchema>;

export const uploadResultSchema = z.object({
  id: z.string(),
  status: liveDocumentStatusSchema,
  duplicate: z
    .boolean()
    .describe('True when these bytes already had a document, which is the one returned.'),
});
export type UploadResult = z.output<typeof uploadResultSchema>;

// What a caller may correct, by the `update_document` tool of the specification. The
// pipeline validates the values against the registry: this only bounds the envelope.
export const documentCorrectionSchema = z.strictObject({
  type: z.string().min(1).optional(),
  core: jsonObjectSchema.optional(),
  fields: jsonObjectSchema.optional(),
  private: z.boolean().optional(),
});
export type DocumentCorrection = z.output<typeof documentCorrectionSchema>;
