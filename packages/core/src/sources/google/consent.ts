import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { type SecretBox, SettingsSecretError } from '../../settings/secret-box.ts';

// The `state` of a consent is the request itself, sealed: no row to store or clean up,
// and nothing in it can be read or altered on its way through Google and the browser.
const STATE_SLOT = 'google-consent';
const STATE_LIFETIME_MS = 10 * 60_000;
const VERIFIER_BYTES = 32;

const stateSchema = z.object({
  source_id: z.string(),
  session_id: z.string(),
  verifier: z.string(),
  expires_at: z.number(),
});

export interface ConsentRequestState {
  readonly sourceId: string;
  readonly sessionId: string;
  /** The PKCE verifier, which only the exchange of the code needs. */
  readonly verifier: string;
}

/** A PKCE verifier and its S256 challenge (RFC 7636). */
export const pkcePair = (): { readonly verifier: string; readonly challenge: string } => {
  const verifier = randomBytes(VERIFIER_BYTES).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
};

export const sealConsentState = (
  secrets: SecretBox,
  { sourceId, sessionId, verifier }: ConsentRequestState,
  now: number = Date.now(),
): string =>
  secrets.seal(
    STATE_SLOT,
    JSON.stringify({
      source_id: sourceId,
      session_id: sessionId,
      verifier,
      expires_at: now + STATE_LIFETIME_MS,
    }),
  );

const parsedJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/**
 * The request a `state` came from, or undefined when it does not open, expired, or was
 * started by another session: an answer of Google that a session did not ask for is
 * never bound to a source.
 */
export const openConsentState = (
  secrets: SecretBox,
  state: string,
  sessionId: string,
  now: number = Date.now(),
): ConsentRequestState | undefined => {
  let opened: string;
  try {
    opened = secrets.open(STATE_SLOT, state);
  } catch (error) {
    if (error instanceof SettingsSecretError) return undefined;
    throw error;
  }
  const parsed = stateSchema.safeParse(parsedJson(opened));
  if (!parsed.success) return undefined;
  const { source_id: sourceId, session_id: boundTo, verifier, expires_at: expiresAt } = parsed.data;
  if (boundTo !== sessionId || expiresAt < now) return undefined;
  return { sourceId, sessionId, verifier };
};
