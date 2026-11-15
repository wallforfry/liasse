import { Navigate, Outlet, useLocation } from 'react-router';
import { useSession } from '../api/session.ts';
import { Skeleton } from '../components/ui/skeleton.tsx';

/** The pages behind the login: shown with a live session, else the login page. */
export const RequireSession = () => {
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
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return <Outlet />;
};
