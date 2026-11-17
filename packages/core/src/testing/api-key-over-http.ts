import { AUTH_BASE_PATH } from '@liasse/contract';
import { z } from 'zod';

export interface SignInRequest {
  /** Where the server listens. */
  readonly baseUrl: string;
  /** Its `PUBLIC_URL`: the `Origin` the auth server expects of a browser. */
  readonly publicUrl: string;
  readonly account: { readonly email: string; readonly password: string };
}

export interface ApiKeyRequest extends SignInRequest {
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

const poster =
  ({ baseUrl, publicUrl }: Pick<SignInRequest, 'baseUrl' | 'publicUrl'>) =>
  (path: string, body: unknown, cookie = '') =>
    fetch(new URL(`${AUTH_BASE_PATH}${path}`, baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: publicUrl,
        ...(cookie === '' ? {} : { Cookie: cookie }),
      },
      body: JSON.stringify(body),
    });

/** Signs the account in as the web UI does. Resolves to the `Cookie` header of its session. */
export const signInOverHttp = async (request: SignInRequest): Promise<string> => {
  const signedIn = await poster(request)('/sign-in/email', request.account);
  if (!signedIn.ok) throw failed('Signing in', signedIn);
  return cookieHeaderOf(signedIn);
};

/**
 * Creates an API key the way a person does in the web UI: signs the account in, then asks
 * the auth server for a key with the session cookie. For a server started by a test or an
 * evaluation run, which has no one to open the web UI.
 */
export const createApiKeyOverHttp = async ({
  name,
  ...request
}: ApiKeyRequest): Promise<string> => {
  const cookie = await signInOverHttp(request);
  const created = await poster(request)('/api-key/create', { name }, cookie);
  if (!created.ok) throw failed('Creating an API key', created);
  return createdSchema.parse(await created.json()).key;
};
