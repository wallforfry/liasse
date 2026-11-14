import { z } from 'zod';

// The Hindsight HTTP API, version 1.2.1 (OpenAPI `info.version`), as far as Liasse uses
// it. Field names are the ones of the wire.

/** One entry of `items` in `POST /v1/default/banks/{bank_id}/memories`. */
export interface RetainItem {
  readonly content: string;
  // Hindsight deletes the memories of an existing document with this id before it
  // stores the new ones, which is what makes a corrected retain a replacement.
  readonly document_id: string;
  readonly context: string;
  readonly metadata: Readonly<Record<string, string>>;
  readonly timestamp?: string;
}

// Hindsight answers 200 with more fields (`bank_id`, `usage`, `operation_id`); only
// what the client relies on is required, so a field added upstream does not break it.
export const retainResponseSchema = z.object({
  success: z.literal(true),
  items_count: z.number().int().min(1),
});

export const deleteDocumentResponseSchema = z.object({ success: z.literal(true) });

export const errorResponseSchema = z.object({ detail: z.string() });

/** The `detail` of the 404 Hindsight answers for a document, or a bank, it does not hold. */
export const ABSENT_DOCUMENT_DETAIL = 'Document not found';

const DEFAULT_TENANT_PATH = 'v1/default/banks';

const bankPath = (bank: string): string => `${DEFAULT_TENANT_PATH}/${encodeURIComponent(bank)}`;

export const retainPath = (bank: string): string => `${bankPath(bank)}/memories`;

export const documentPath = (bank: string, documentId: string): string =>
  `${bankPath(bank)}/documents/${encodeURIComponent(documentId)}`;
