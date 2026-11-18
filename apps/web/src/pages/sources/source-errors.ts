import { LiasseApiError } from '@liasse/sdk';
import { serverIssuesOf } from '../settings/settings-errors.ts';
import type { Issues } from '../settings/settings-validation.ts';

/**
 * The fields a refused save of a source names, by the paths of the form. The server says why
 * it needs the password: for another server, one that no longer opens, or none.
 */
export const sourceIssuesOf = (error: unknown): Issues =>
  error instanceof LiasseApiError && error.code === 'source_secret_required'
    ? new Map([['secret', error.message]])
    : serverIssuesOf(error);
