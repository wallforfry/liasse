import { LiasseApiError } from '@liasse/sdk';
import { serverIssuesOf } from '../settings/settings-errors.ts';
import { type Issues, NO_ISSUES } from '../settings/settings-validation.ts';

/** The server did not print this token: it is mistyped, or the server restarted since. */
export const isWrongToken = (error: unknown): boolean =>
  error instanceof LiasseApiError && error.code === 'invalid_setup_token';

/** An account exists: someone finished the onboarding meanwhile. */
export const isSetupDone = (error: unknown): boolean =>
  error instanceof LiasseApiError && error.code === 'setup_done';

const ACCOUNT_PREFIX = 'account.';

/** The fields of the account a refused setup names, by the names of the account form. */
export const accountIssuesOf = (error: unknown): Issues =>
  new Map(
    [...serverIssuesOf(error)]
      .filter(([path]) => path.startsWith(ACCOUNT_PREFIX))
      .map(([path, message]) => [path.slice(ACCOUNT_PREFIX.length), message]),
  );

/** The fields of the settings a refused setup or check names, by the paths of the form. */
export const settingsIssuesOf = (error: unknown): Issues => {
  const issues = [...serverIssuesOf(error)].filter(
    ([path]) => !path.startsWith(ACCOUNT_PREFIX) && path !== 'token',
  );
  return issues.length === 0 ? NO_ISSUES : new Map(issues);
};
