import { LiasseApiError } from '@liasse/sdk';
import { serverIssuesOf } from '../settings/settings-errors.ts';
import type { Issues } from '../settings/settings-validation.ts';
import { PASSWORD_AGAIN_MESSAGE } from './source-form.ts';

/** The fields a refused save of a source names, by the paths of the form. */
export const sourceIssuesOf = (error: unknown): Issues =>
  error instanceof LiasseApiError && error.code === 'source_secret_required'
    ? new Map([['secret', PASSWORD_AGAIN_MESSAGE]])
    : serverIssuesOf(error);
