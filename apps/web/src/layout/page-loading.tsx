import { Skeleton } from '../components/ui/skeleton.tsx';

/** The whole page, while the server has not said what to show. */
export const PageLoading = () => (
  <div className="flex min-h-svh items-center justify-center p-6" aria-busy="true">
    <Skeleton className="h-8 w-48" />
  </div>
);
