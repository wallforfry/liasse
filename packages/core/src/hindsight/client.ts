import type { z } from 'zod';
import { baseUrl } from '../config/fields.ts';
import type { Config } from '../config/schema.ts';
import { type HindsightOperation, HindsightUrlError } from './errors.ts';
import {
  type HindsightRequest,
  invalidResponse,
  readJson,
  type RequestPolicy,
  send,
  statusError,
} from './request.ts';
import {
  ABSENT_DOCUMENT_DETAIL,
  deleteDocumentResponseSchema,
  documentPath,
  errorResponseSchema,
  type RetainItem,
  retainPath,
  retainResponseSchema,
} from './wire.ts';

export type HindsightSettings = NonNullable<Config['hindsight']>;

export type HindsightClientOptions = Partial<RequestPolicy>;

export interface HindsightClient {
  /** Stores the item, in place of what its `document_id` held in the bank before. */
  readonly retain: (item: RetainItem, signal?: AbortSignal) => Promise<void>;
  /**
   * Deletes a document and its memories from the bank. Resolves to false when the bank
   * held no such document, which is the state a forget asks for.
   */
  readonly forget: (documentId: string, signal?: AbortSignal) => Promise<boolean>;
}

// A synchronous retain returns once Hindsight has extracted and stored the memories,
// which costs it model calls: the bound is the one of a slow model, not of a lookup.
const DEFAULTS = { timeoutMs: 120_000, retries: 2, retryDelayMs: 500 } as const;

const NOT_FOUND = 404;

const endpoint = (base: string, path: string): string => `${base.replace(/\/+$/, '')}/${path}`;

const readSuccess = async (
  operation: HindsightOperation,
  response: Response,
  schema: z.ZodType,
): Promise<void> => {
  if (!response.ok) throw await statusError(operation, response);
  const parsed = schema.safeParse(await readJson(operation, response));
  if (!parsed.success) throw invalidResponse(operation, response.status);
};

// Hindsight 1.2.1 answers 404 `{"detail":"Document not found"}` for a document or a
// bank it does not hold. Its framework answers 404 `{"detail":"Not Found"}` for a path
// that is no route, and a proxy answers 404 with a body of its own. Only the exact
// first answer confirms the document is gone; any other 404 fails, so a mistyped base
// URL, another service or a message renamed upstream never passes for a forget.
const isAbsentDocument = async (response: Response): Promise<boolean> => {
  if (response.status !== NOT_FOUND) return false;
  const body: unknown = await response
    .clone()
    .json()
    .catch(() => undefined);
  const parsed = errorResponseSchema.safeParse(body);
  return parsed.success && parsed.data.detail === ABSENT_DOCUMENT_DETAIL;
};

/**
 * A client of one Hindsight bank. The bank needs no creation: Hindsight creates it at
 * the first retain. Every failure is a `HindsightError`, which holds no part of the
 * request, of the response body, of the URL or of the key.
 */
export const createHindsightClient = (
  { url, bank, apiKey }: HindsightSettings,
  options: HindsightClientOptions = {},
): HindsightClient => {
  if (!baseUrl.safeParse(url).success) throw new HindsightUrlError();
  const policy: RequestPolicy = { fetch, ...DEFAULTS, ...options };
  const authorization = apiKey === undefined ? {} : { authorization: `Bearer ${apiKey}` };

  const retainRequest = (item: RetainItem): HindsightRequest<void> => ({
    operation: 'retain',
    method: 'POST',
    url: endpoint(url, retainPath(bank)),
    headers: { ...authorization, 'content-type': 'application/json' },
    body: JSON.stringify({ items: [item] }),
    read: (response) => readSuccess('retain', response, retainResponseSchema),
  });

  const forgetRequest = (documentId: string): HindsightRequest<boolean> => ({
    operation: 'forget',
    method: 'DELETE',
    url: endpoint(url, documentPath(bank, documentId)),
    headers: authorization,
    read: async (response) => {
      if (await isAbsentDocument(response)) return false;
      await readSuccess('forget', response, deleteDocumentResponseSchema);
      return true;
    },
  });

  return {
    retain: (item, signal) => send(policy, retainRequest(item), signal),
    forget: (documentId, signal) => send(policy, forgetRequest(documentId), signal),
  };
};
