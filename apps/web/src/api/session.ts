import type { LiasseClient } from '@liasse/sdk';
import { createContext, useContext } from 'react';

export type SessionStatus = 'loading' | 'signed_out' | 'signed_in';

export interface SessionState {
  readonly status: SessionStatus;
  /** The REST API, called with the session cookie. */
  readonly client: LiasseClient;
  /** Rejects with the refusal of the server: a wrong password, too many attempts. */
  readonly logIn: (password: string) => Promise<void>;
  readonly logOut: () => Promise<void>;
}

export const SessionContext = createContext<SessionState | undefined>(undefined);

export const useSession = (): SessionState => {
  const state = useContext(SessionContext);
  if (state === undefined) throw new Error('useSession needs a SessionProvider above it.');
  return state;
};

export const useClient = (): LiasseClient => useSession().client;
