import { LiasseResponseError } from '@liasse/sdk';
import { z } from 'zod';

/** The auth server refused the request: a wrong password, too many attempts, no session. */
export class AuthApiError extends Error {
  override readonly name = 'AuthApiError';
  readonly status: number;
  /** Stable, for programs: `INVALID_EMAIL_OR_PASSWORD`, `INVALID_PASSWORD`... */
  readonly code: string | undefined;

  constructor(status: number, message: string, code: string | undefined) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// better-fetch spreads the JSON body of a refusal next to the status of the answer.
const refusalSchema = z.object({
  status: z.number(),
  statusText: z.string().optional(),
  message: z.string().optional(),
  code: z.string().optional(),
});

/** What every call of the auth client resolves to; a network failure rejects instead. */
export interface AuthResult {
  readonly data: unknown;
  readonly error: unknown;
}

const refusalOf = (error: unknown): Error => {
  const parsed = refusalSchema.safeParse(error);
  if (!parsed.success) {
    return new LiasseResponseError(0, 'The auth server answered without its error body.');
  }
  const { status, statusText, message, code } = parsed.data;
  return new AuthApiError(
    status,
    message ??
      (statusText === undefined || statusText === '' ? `HTTP ${String(status)}` : statusText),
    code,
  );
};

/** The answer of the auth server, parsed with `schema`; rejects with its refusal. */
export const unwrap = <Schema extends z.ZodType>(
  schema: Schema,
  { data, error }: AuthResult,
): z.output<Schema> => {
  if (error !== null && error !== undefined) throw refusalOf(error);
  const parsed = schema.safeParse(data);
  if (parsed.success) return parsed.data;
  throw new LiasseResponseError(
    200,
    'The auth server answer is not the expected one.',
    parsed.error,
  );
};
