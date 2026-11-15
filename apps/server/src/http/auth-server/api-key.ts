import { API_KEY_PREFIX, type Auth } from '@liasse/core/auth';
import { bearerTokenOf, type Credential } from '../auth.ts';

/**
 * `Authorization: Bearer <key>` with an API key of better-auth, enabled and unexpired. Keys
 * are kept as digests and looked up by digest, so the lookup tells nothing of a key
 * through its timing.
 */
export const apiKeyBearer =
  (auth: Auth): Credential =>
  async (context) => {
    const key = bearerTokenOf(context);
    if (key?.startsWith(API_KEY_PREFIX) !== true) return false;
    const { valid } = await auth.api.verifyApiKey({ body: { key } });
    return valid;
  };
