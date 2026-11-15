import type { ReactNode } from 'react';
import { SessionProvider, type SessionProviderProps } from './api/session-provider.tsx';
import { Toaster } from './components/ui/sonner.tsx';
import { ThemeProvider } from './theme/theme-provider.tsx';

/** Everything around the router: theme, session and the calls under it, toasts. */
export const AppProviders = ({
  children,
  ...session
}: Omit<SessionProviderProps, 'children'> & { readonly children: ReactNode }) => (
  <ThemeProvider>
    <SessionProvider {...session}>
      {children}
      <Toaster richColors closeButton />
    </SessionProvider>
  </ThemeProvider>
);
