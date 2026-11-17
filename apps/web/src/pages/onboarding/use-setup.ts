import type { SettingsDraft, SetupAccount } from '@liasse/contract';
import { useMutation } from '@tanstack/react-query';
import { useClient } from '../../api/session.ts';

// The variables hold the token, the keys and the password: dropped as soon as nothing shows
// the outcome of the call, rather than kept for the five minutes of the default.
const FORGET_AT_ONCE = 0;

/** A check of the settings with the setup token: what each part answered, nothing saved. */
export const useSetupCheck = (token: string, onError: (error: Error) => void) => {
  const client = useClient();
  return useMutation({
    mutationFn: async (settings: SettingsDraft) => client.checkSetup({ token, settings }),
    onError,
    gcTime: FORGET_AT_ONCE,
  });
};

export interface SetupRequestValues {
  readonly token: string;
  readonly account: SetupAccount;
  readonly settings: SettingsDraft;
}

/** Creates the first account and saves the settings with it. */
export const useCompleteSetup = () => {
  const client = useClient();
  return useMutation({
    mutationFn: async (request: SetupRequestValues) => client.completeSetup(request),
    gcTime: FORGET_AT_ONCE,
  });
};
