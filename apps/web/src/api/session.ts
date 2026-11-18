import type { LiasseClient } from '@liasse/sdk';
import { createContext, useContext } from 'react';
import type { WebAuthClient } from './auth-client.ts';

export type SessionStatus = 'loading' | 'signed_out' | 'signed_in';

export interface SessionState {
  readonly status: SessionStatus;
  /** Whether no account exists yet, which shows the onboarding; undefined until known. */
  readonly needsSetup: boolean | undefined;
  /** Records that an account exists now, which ends the onboarding on every route. */
  readonly setupDone: () => void;
  /** The REST API, called with the session cookie. */
  readonly client: LiasseClient;
  /** The auth server: password, API keys, OAuth consent. */
  readonly auth: WebAuthClient;
  /**
   * Rejects with the refusal of the server: a wrong password, too many attempts. Inside an
   * OAuth authorization, leaves the page for the client instead of opening the UI.
   */
  readonly logIn: (email: string, password: string) => Promise<void>;
  readonly logOut: () => Promise<void>;
  /**
   * Leaves the application for a redirection of the auth server or for the consent page of
   * Google; rejects a script URL.
   */
  readonly followRedirect: (url: string) => void;
}

export const SessionContext = createContext<SessionState | undefined>(undefined);

export const useSession = (): SessionState => {
  const state = useContext(SessionContext);
  if (state === undefined) throw new Error('useSession needs a SessionProvider above it.');
  return state;
};

export const useClient = (): LiasseClient => useSession().client;

export const useAuth = (): WebAuthClient => useSession().auth;
