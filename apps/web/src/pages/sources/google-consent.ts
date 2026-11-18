import type { Source } from '@liasse/sdk';
import { useMutation } from '@tanstack/react-query';
import { useClient, useSession } from '../../api/session.ts';

/** Whether a Drive source waits for a consent of Google before it can run. */
export const needsGoogleConsent = (source: Source): boolean =>
  source.kind === 'gdrive' && (source.needs_attention || source.secret !== 'set');

/** Sends the browser to the consent page of Google for a Drive source. */
export const useConnectGoogle = (id: string) => {
  const client = useClient();
  const { followRedirect } = useSession();
  return useMutation({
    mutationFn: async () => client.startGoogleConsent(id),
    onSuccess: ({ url }) => {
      followRedirect(url);
    },
  });
};
