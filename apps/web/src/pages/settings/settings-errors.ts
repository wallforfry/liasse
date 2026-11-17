import { LiasseApiError } from '@liasse/sdk';
import { z } from 'zod';
import { type Issues, issuesFrom, NO_ISSUES } from './settings-validation.ts';

const invalidRequestDetailsSchema = z.object({
  issues: z.array(z.object({ path: z.string(), message: z.string() })),
});

// The route reads the body, so a field the schema refused is under `settings.`; a rule the
// server checks against the stored keys names the document's own path.
const BODY_PREFIX = /^settings\./u;

/** The fields a refused save names, by the paths of the form. */
export const serverIssuesOf = (error: unknown): Issues => {
  if (!(error instanceof LiasseApiError) || error.code !== 'invalid_request') return NO_ISSUES;
  const details = invalidRequestDetailsSchema.safeParse(error.details);
  if (!details.success) return NO_ISSUES;
  return issuesFrom(
    details.data.issues.map(({ path, message }) => ({
      path: path.replace(BODY_PREFIX, ''),
      message,
    })),
  );
};

/** Someone saved the settings since this page read them. */
export const isStaleVersion = (error: unknown): boolean =>
  error instanceof LiasseApiError && error.code === 'settings_conflict';

/** A live document exists since the settings were read: the embedder can no longer change. */
export const isEmbedderLocked = (error: unknown): boolean =>
  error instanceof LiasseApiError && error.code === 'embedder_locked';
