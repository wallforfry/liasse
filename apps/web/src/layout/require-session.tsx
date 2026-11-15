import { Navigate, Outlet, useLocation } from 'react-router';
import { useSession } from '../api/session.ts';
import { Skeleton } from '../components/ui/skeleton.tsx';

export interface RequireSessionProps {
  /**
   * Hands the query string of the page to the login page, for an OAuth authorization: the
   * login posts it back to the auth server, which then continues the flow.
   */
  readonly keepQuery?: boolean;
}

/** The pages behind the login: shown with a live session, else the login page. */
export const RequireSession = ({ keepQuery = false }: RequireSessionProps) => {
  const { status } = useSession();
  const location = useLocation();
  if (status === 'loading') {
    return (
      <div className="flex min-h-svh items-center justify-center p-6" aria-busy="true">
        <Skeleton className="h-8 w-48" />
      </div>
    );
  }
  if (status === 'signed_out') {
    return (
      <Navigate
        to={{ pathname: '/login', search: keepQuery ? location.search : '' }}
        replace
        state={{ from: location.pathname + location.search }}
      />
    );
  }
  return <Outlet />;
};
