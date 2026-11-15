import { AUTH_BASE_PATH } from '@liasse/contract';
import { z } from 'zod';

export interface ApiKeyRequest {
  /** Where the server listens. */
  readonly baseUrl: string;
  /** Its `PUBLIC_URL`: the `Origin` the auth server expects of a browser. */
  readonly publicUrl: string;
  readonly account: { readonly email: string; readonly password: string };
  readonly name: string;
}

const createdSchema = z.object({ key: z.string() });

const cookieHeaderOf = (response: Response): string =>
  response.headers
    .getSetCookie()
    .map((line) => line.split(';', 1)[0] ?? '')
    .join('; ');

const failed = (step: string, response: Response): Error =>
  new Error(`${step} failed with HTTP ${String(response.status)}`);

/**
 * Creates an API key the way a person does in the web UI: signs the account in, then asks
 * the auth server for a key with the session cookie. For a server started by a test or an
 * evaluation run, which has no one to open the web UI.
 */
export const createApiKeyOverHttp = async ({
  baseUrl,
  publicUrl,
  account,
  name,
}: ApiKeyRequest): Promise<string> => {
  const post = (path: string, body: unknown, cookie = '') =>
    fetch(new URL(`${AUTH_BASE_PATH}${path}`, baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: publicUrl,
        ...(cookie === '' ? {} : { Cookie: cookie }),
      },
      body: JSON.stringify(body),
    });
  const signedIn = await post('/sign-in/email', account);
  if (!signedIn.ok) throw failed('Signing in', signedIn);
  const created = await post('/api-key/create', { name }, cookieHeaderOf(signedIn));
  if (!created.ok) throw failed('Creating an API key', created);
  return createdSchema.parse(await created.json()).key;
};
