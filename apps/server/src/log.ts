import { sqlStateOf } from '@liasse/core/db';
import { ModelProviderError } from '@liasse/core/models';

export type LogFields = Readonly<Record<string, string | number | boolean | undefined>>;

export interface Logger {
  /** One JSON object per line. Callers pass counts, codes and names, never content. */
  readonly event: (name: string, fields?: LogFields) => void;
  /** A sentence for the operator, as it is. */
  readonly notice: (message: string) => void;
}

export type WriteLine = (line: string) => void;

// stdout belongs to a protocol when the server speaks MCP over stdio: everything the
// server says about itself goes to stderr.
const toStderr: WriteLine = (line) => {
  process.stderr.write(`${line}\n`);
};

export const createLogger = (write: WriteLine = toStderr): Logger => ({
  event: (name, fields = {}) => {
    write(JSON.stringify({ event: name, ...fields }));
  },
  notice: write,
});

// A `ModelProviderError` holds identifiers only, so all of them may be logged.
const describeProviderFailure = (error: unknown): LogFields =>
  error instanceof ModelProviderError
    ? {
        provider: error.provider,
        model: error.model,
        http_status: error.statusCode,
        provider_code: error.code,
      }
    : {};

/**
 * What may be logged of an error nobody expected: its class, the class of its cause, the
 * identifiers of a provider failure it is or wraps and, for a database failure, its
 * SQLSTATE. A message is left out, since Drizzle quotes the statement and its parameters
 * in it, and those may be document content.
 */
export const describeError = (error: unknown): LogFields => {
  if (!(error instanceof Error)) return { error: typeof error };
  const sqlState = sqlStateOf(error);
  const { cause } = error;
  return {
    error: error.name,
    ...(cause instanceof Error ? { cause: cause.name } : {}),
    ...describeProviderFailure(cause),
    ...describeProviderFailure(error),
    ...(sqlState === undefined ? {} : { sqlstate: sqlState }),
  };
};
