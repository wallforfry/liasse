import { createLiasseClient, LiasseApiError } from '@liasse/sdk';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { isUnauthorized } from './errors.ts';
import { SessionContext, type SessionState, type SessionStatus } from './session.ts';
import { createSessionApi } from './session-api.ts';

export interface SessionProviderProps {
  readonly children: ReactNode;
  /** The origin of the page by default. */
  readonly baseUrl?: string;
  /** The global `fetch` by default; tests answer in its place. */
  readonly fetch?: typeof fetch;
}

/** The CSRF token of the session, read when a request is sent rather than when rendering. */
interface CsrfToken {
  readonly get: () => string;
  readonly set: (token: string) => void;
}

const createCsrfToken = (): CsrfToken => {
  let token = '';
  return {
    get: () => token,
    set: (next) => {
      token = next;
    },
  };
};

// A refusal of the API is an answer: asking again would get the same one.
const retryNetworkFailures = (failures: number, error: unknown): boolean =>
  !(error instanceof LiasseApiError) && failures < 2;

/**
 * The session of the web UI and everything that calls the server under it. A 401 from
 * any call ends the session here, which sends the person to the login page.
 */
export const SessionProvider = ({
  children,
  baseUrl = window.location.origin,
  fetch,
}: SessionProviderProps) => {
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [csrfToken] = useState(createCsrfToken);
  const sessionApi = useMemo(
    () => createSessionApi({ baseUrl, ...(fetch === undefined ? {} : { fetch }) }),
    [baseUrl, fetch],
  );
  const client = useMemo(
    () =>
      createLiasseClient({
        baseUrl,
        session: { csrfToken: csrfToken.get },
        ...(fetch === undefined ? {} : { fetch }),
      }),
    [baseUrl, fetch, csrfToken],
  );
  const [queryClient] = useState(() => {
    const onError = (error: unknown): void => {
      if (!isUnauthorized(error)) return;
      csrfToken.set('');
      setStatus('signed_out');
    };
    return new QueryClient({
      queryCache: new QueryCache({ onError }),
      mutationCache: new MutationCache({ onError }),
      defaultOptions: {
        queries: { retry: retryNetworkFailures, refetchOnWindowFocus: false },
      },
    });
  });

  useEffect(() => {
    let current = true;
    void sessionApi
      .read()
      .catch(() => undefined)
      .then((session) => {
        if (!current) return;
        csrfToken.set(session?.csrf_token ?? '');
        setStatus(session === undefined ? 'signed_out' : 'signed_in');
      });
    return () => {
      current = false;
    };
  }, [sessionApi, csrfToken]);

  useEffect(() => {
    if (status === 'signed_out') queryClient.clear();
  }, [status, queryClient]);

  const state = useMemo<SessionState>(
    () => ({
      status,
      client,
      logIn: async (password) => {
        const session = await sessionApi.logIn(password);
        csrfToken.set(session.csrf_token);
        setStatus('signed_in');
      },
      logOut: async () => {
        await sessionApi.logOut(csrfToken.get());
        csrfToken.set('');
        setStatus('signed_out');
      },
    }),
    [status, client, sessionApi, csrfToken],
  );

  return (
    <SessionContext value={state}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </SessionContext>
  );
};
