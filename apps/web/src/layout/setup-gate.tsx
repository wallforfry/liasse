import { Outlet } from 'react-router';
import { useSession } from '../api/session.ts';
import { OnboardingPage } from '../pages/onboarding/onboarding-page.tsx';
import { PageLoading } from './page-loading.tsx';

/** Every route, the login included, shows the onboarding while no account exists. */
export const SetupGate = () => {
  const { needsSetup } = useSession();
  if (needsSetup === undefined) return <PageLoading />;
  return needsSetup ? <OnboardingPage /> : <Outlet />;
};
