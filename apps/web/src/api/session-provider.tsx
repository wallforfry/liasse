import { createLiasseClient, LiasseApiError } from '@liasse/sdk';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { AuthApiError, unwrap } from './auth-result.ts';
import { createWebAuthClient } from './auth-client.ts';
import { sessionAnswerSchema, signInAnswerSchema } from './auth-schemas.ts';
import { isUnauthorized } from './errors.ts';
import { checkedRedirect, leavePage, type NavigateAway } from './redirect.ts';
import { SessionContext, type SessionState, type SessionStatus } from './session.ts';

export interface SessionProviderProps {
  readonly children: ReactNode;
  /** The origin of the page by default. */
  readonly baseUrl?: string;
  /** The global `fetch` by default; tests answer in its place. */
  readonly fetch?: typeof fetch;
  /** `location.assign` by default, which jsdom does not let tests observe. */
  readonly navigateAway?: NavigateAway;
}

// A refusal of a server is an answer: asking again would get the same one.
const retryNetworkFailures = (failures: number, error: unknown): boolean =>
  !(error instanceof LiasseApiError || error instanceof AuthApiError) && failures < 2;

/**
 * The session of the web UI and everything that calls the server under it. A 401 from
 * any call ends the session here, which sends the person to the login page.
 */
export const SessionProvider = ({
  children,
  baseUrl = window.location.origin,
  fetch,
  navigateAway = leavePage,
}: SessionProviderProps) => {
  const [status, setStatus] = useState<SessionStatus>('loading');
  // Held here rather than in the query cache, which the end of a session clears.
  const [needsSetup, setNeedsSetup] = useState<boolean | undefined>(undefined);
  const auth = useMemo(
    () => createWebAuthClient({ baseUrl, ...(fetch === undefined ? {} : { fetch }) }),
    [baseUrl, fetch],
  );
  const client = useMemo(
    () => createLiasseClient({ baseUrl, session: true, ...(fetch === undefined ? {} : { fetch }) }),
    [baseUrl, fetch],
  );
  const [queryClient] = useState(() => {
    const onError = (error: unknown): void => {
      if (isUnauthorized(error)) setStatus('signed_out');
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
    void auth
      .getSession()
      .then((result) => unwrap(sessionAnswerSchema, result))
      .catch(() => null)
      .then((session) => {
        if (current) setStatus(session === null ? 'signed_out' : 'signed_in');
      });
    return () => {
      current = false;
    };
  }, [auth]);

  useEffect(() => {
    let current = true;
    void client.getSetupStatus().then(
      ({ needs_setup }) => {
        if (current) setNeedsSetup(needs_setup);
      },
      // A server that cannot say is not held up by the onboarding: its login page tells why.
      () => {
        if (current) setNeedsSetup(false);
      },
    );
    return () => {
      current = false;
    };
  }, [client]);

  useEffect(() => {
    if (status === 'signed_out') queryClient.clear();
  }, [status, queryClient]);

  const state = useMemo<SessionState>(() => {
    const followRedirect = (url: string): void => {
      navigateAway(checkedRedirect(url));
    };
    return {
      status,
      needsSetup,
      setupDone: () => {
        setNeedsSetup(false);
      },
      client,
      auth,
      followRedirect,
      logIn: async (email, password) => {
        const answer = unwrap(signInAnswerSchema, await auth.signIn.email({ email, password }));
        if (answer.redirect) followRedirect(answer.url);
        else setStatus('signed_in');
      },
      logOut: async () => {
        try {
          unwrap(z.unknown(), await auth.signOut());
        } catch (error) {
          if (!isUnauthorized(error)) throw error;
        }
        setStatus('signed_out');
      },
    };
  }, [status, needsSetup, client, auth, navigateAway]);

  return (
    <SessionContext value={state}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </SessionContext>
  );
};
