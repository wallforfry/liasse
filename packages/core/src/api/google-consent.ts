import type { GoogleConsent } from '@liasse/contract';
import type { GoogleConsentOutcome } from '@liasse/contract/domain';
import { eq } from 'drizzle-orm';
import { ingestionSources } from '../db/schema/sources.ts';
import { openConsentState, pkcePair, sealConsentState } from '../sources/google/consent.ts';
import { DRIVE_READONLY_SCOPE, GoogleAuthorizationError } from '../sources/google/oauth.ts';
import { cancelPolls, queuePollNow } from '../sources/schedule.ts';
import { openSourceSecret, updateSourceSecret } from '../sources/secret.ts';
import { readSource } from '../sources/store.ts';
import type { StoredKey } from '../settings/keys.ts';
import { ApiError } from './errors.ts';
import type { SourcesContext } from './sources.ts';

const EXCHANGE_TIMEOUT_MS = 30_000;

/**
 * The consent page of Google for a Drive source, for the signed-in session `sessionId`:
 * read-only access to Drive, offline, with PKCE. Rejects with `source_not_found`,
 * `source_kind_mismatch` for a source of another kind, and `google_client_missing` while
 * the settings hold no Google client.
 */
export const startGoogleConsent = async (
  { db, secrets, google }: SourcesContext,
  sourceId: string,
  sessionId: string,
): Promise<GoogleConsent> => {
  const source = await readSource(db, sourceId);
  if (source === undefined) throw new ApiError('source_not_found', 'No source has this id.');
  if (source.kind !== 'gdrive') {
    throw new ApiError('source_kind_mismatch', 'Only a Drive source connects to Google.');
  }
  const client = await google.client();
  if (client === undefined) {
    throw new ApiError(
      'google_client_missing',
      'Save the client id and secret of your Google Cloud project in the settings first.',
    );
  }
  const { verifier, challenge } = pkcePair();
  return {
    url: google.oauth.consentUrl({
      clientId: client.clientId,
      redirectUri: google.redirectUri,
      scope: DRIVE_READONLY_SCOPE,
      state: sealConsentState(secrets, { sourceId, sessionId, verifier }),
      codeChallenge: challenge,
    }),
  };
};

/** What Google put in the query of the redirect back to Liasse. */
export interface GoogleConsentAnswer {
  readonly code?: string | undefined;
  readonly state?: string | undefined;
  readonly error?: string | undefined;
}

export interface GoogleConsentResult {
  readonly outcome: GoogleConsentOutcome;
  /** The source the consent was for, once its `state` was found valid. */
  readonly sourceId?: string;
}

// Stores the refresh token as the source's secret, which clears the flag of refused
// credentials and runs an enabled source at once. Resolves to the secret it replaced, or
// undefined when the source is gone or no longer a Drive source.
const sealGrant = (
  { db, secrets }: Pick<SourcesContext, 'db' | 'secrets'>,
  sourceId: string,
  refreshToken: string,
): Promise<StoredKey | undefined> =>
  db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(ingestionSources)
      .where(eq(ingestionSources.id, sourceId))
      .for('update');
    if (row?.kind !== 'gdrive') return undefined;
    await tx
      .update(ingestionSources)
      .set({
        secret: updateSourceSecret(secrets, sourceId, null, {
          action: 'replace',
          value: refreshToken,
        }),
        needsAttention: false,
        updatedAt: new Date(),
      })
      .where(eq(ingestionSources.id, sourceId));
    await cancelPolls(tx, sourceId);
    if (row.enabled) await queuePollNow(tx, sourceId);
    return openSourceSecret(secrets, sourceId, row.secret);
  });

/**
 * Ends a consent: exchanges the code for a refresh token and seals it in the source, which
 * then runs at once if enabled. A `state` this session did not start, or one older than ten
 * minutes, binds nothing. The person may untick the read access on the consent page: a grant
 * without it is revoked and refused.
 */
export const completeGoogleConsent = async (
  { db, secrets, connectors, google }: SourcesContext,
  answer: GoogleConsentAnswer,
  sessionId: string,
): Promise<GoogleConsentResult> => {
  const request =
    answer.state === undefined ? undefined : openConsentState(secrets, answer.state, sessionId);
  if (request === undefined) return { outcome: 'invalid' };
  const { sourceId } = request;
  if (answer.error !== undefined || answer.code === undefined) {
    return { outcome: 'denied', sourceId };
  }
  const client = await google.client();
  if (client === undefined) return { outcome: 'refused', sourceId };
  const signal = AbortSignal.timeout(EXCHANGE_TIMEOUT_MS);
  const grant = await google.oauth
    .exchange(
      client,
      { code: answer.code, codeVerifier: request.verifier, redirectUri: google.redirectUri },
      signal,
    )
    .catch((error: unknown) => {
      if (error instanceof GoogleAuthorizationError) return undefined;
      throw error;
    });
  if (grant === undefined) return { outcome: 'refused', sourceId };
  // Best effort, as for a deleted source: an unused refresh token ends on its own.
  const forget = (token: string) =>
    connectors.gdrive.forget?.(token, signal).catch(() => undefined);
  if (!grant.scopes.includes(DRIVE_READONLY_SCOPE)) {
    await forget(grant.refreshToken);
    return { outcome: 'missing_scope', sourceId };
  }
  const replaced = await sealGrant({ db, secrets }, sourceId, grant.refreshToken);
  if (replaced === undefined) {
    await forget(grant.refreshToken);
    return { outcome: 'invalid' };
  }
  if (replaced.state === 'set') await forget(replaced.value);
  return { outcome: 'connected', sourceId };
};
