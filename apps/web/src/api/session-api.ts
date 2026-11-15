import {
  CSRF_HEADER,
  errorBodySchema,
  type UiSession,
  uiSessionSchema,
} from '@liasse/core/contract';
import { LiasseApiError, LiasseResponseError } from '@liasse/sdk';

const SESSION_PATH = '/ui/session';

export interface SessionApiOptions {
  readonly baseUrl: string;
  readonly fetch?: typeof fetch;
}

/** `/ui/session` of the server: not part of the agent API, so not in the SDK. */
export interface SessionApi {
  /** The live session of this browser, or undefined when there is none. */
  readonly read: () => Promise<UiSession | undefined>;
  readonly logIn: (password: string) => Promise<UiSession>;
  readonly logOut: (csrfToken: string) => Promise<void>;
}

const bodyOf = async (response: Response): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
};

const failureOf = async (response: Response): Promise<Error> => {
  const parsed = errorBodySchema.safeParse(await bodyOf(response));
  return parsed.success
    ? new LiasseApiError(response.status, parsed.data)
    : new LiasseResponseError(response.status, 'The server answered without its error body.');
};

const sessionOf = async (response: Response): Promise<UiSession> => {
  if (!response.ok) throw await failureOf(response);
  const parsed = uiSessionSchema.safeParse(await bodyOf(response));
  if (parsed.success) return parsed.data;
  throw new LiasseResponseError(response.status, 'The session answer is not the expected one.');
};

export const createSessionApi = ({
  baseUrl,
  fetch: fetchImpl = globalThis.fetch,
}: SessionApiOptions): SessionApi => {
  const url = new URL(SESSION_PATH, baseUrl);
  const send = async (init: RequestInit): Promise<Response> =>
    fetchImpl(url, { credentials: 'same-origin', ...init });
  return {
    read: async () => {
      const response = await send({ method: 'GET' });
      return response.status === 401 ? undefined : sessionOf(response);
    },
    logIn: async (password) =>
      sessionOf(
        await send({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password }),
        }),
      ),
    logOut: async (csrfToken) => {
      const response = await send({ method: 'DELETE', headers: { [CSRF_HEADER]: csrfToken } });
      if (!response.ok && response.status !== 401) throw await failureOf(response);
    },
  };
};
