import type { ApiErrorCode, ApiErrorKind } from '@liasse/contract';
import { type ApiError, toApiError } from '@liasse/core/api';
import { type CallToolResult, ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';

/**
 * Told of a failure nobody expected, with the tool or resource it happened in. The caller
 * is only told that the server failed: the message may quote a statement or document
 * content, and is never sent.
 */
export type ReportFailure = (operation: string, error: unknown) => void;

const INTERNAL_ERROR: { readonly code: ApiErrorCode; readonly message: string } = {
  code: 'internal_error',
  message: 'The server failed to answer this request.',
};

// The body of a failure, as REST writes it: the details first, so none of them can
// replace the code or the message.
const errorBody = ({ code, message, details }: ApiError) => ({
  error: { ...details, code, message },
});

const asText = (value: unknown): CallToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(value) }],
});

/**
 * Runs the use case behind a tool. Its result is compact JSON; a failure is a tool error
 * whose text is `{"error": {"code", "message", ...}}` with the codes of REST: a feature
 * this build does not provide answers `not_implemented`, where REST answers 501.
 */
export const toolAnswer = async (
  operation: string,
  report: ReportFailure,
  work: () => Promise<unknown>,
): Promise<CallToolResult> => {
  try {
    return asText(await work());
  } catch (error) {
    const known = toApiError(error);
    if (known === undefined) report(operation, error);
    return {
      ...asText(known === undefined ? { error: INTERNAL_ERROR } : errorBody(known)),
      isError: true,
    };
  }
};

// -32002 is the code the MCP specification gives a resource that does not exist.
const RESOURCE_NOT_FOUND = -32002;

const RPC_CODE_OF_KIND: Readonly<Partial<Record<ApiErrorKind, number>>> = {
  not_found: RESOURCE_NOT_FOUND,
  invalid: ErrorCode.InvalidParams,
};

/** The JSON-RPC error a resource read fails with; its data is the body a tool would answer. */
export const resourceError = (
  operation: string,
  report: ReportFailure,
  error: unknown,
): McpError => {
  const known = toApiError(error);
  if (known === undefined) {
    report(operation, error);
    return new McpError(ErrorCode.InternalError, INTERNAL_ERROR.message, {
      error: INTERNAL_ERROR,
    });
  }
  return new McpError(
    RPC_CODE_OF_KIND[known.kind] ?? ErrorCode.InternalError,
    known.message,
    errorBody(known),
  );
};
