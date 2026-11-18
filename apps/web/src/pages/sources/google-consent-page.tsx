import { type GoogleConsentAnswer, googleConsentAnswerSchema } from '@liasse/contract';
import type { GoogleConsentOutcome } from '@liasse/contract/domain';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleAlertIcon, CircleCheckIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useClient } from '../../api/session.ts';
import { ErrorAlert } from '../../components/error-alert.tsx';
import { PageHeader } from '../../components/page-header.tsx';
import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert.tsx';
import { Button } from '../../components/ui/button.tsx';
import { SOURCES_PATH } from '../../layout/navigation.ts';
import { SOURCES_QUERY_KEY } from './sources-query.ts';

interface OutcomeText {
  readonly title: string;
  readonly description: string;
}

const OUTCOMES: Readonly<Record<GoogleConsentOutcome, OutcomeText>> = {
  connected: {
    title: 'Connected to Google',
    description: 'The source reads its Drive folder from now on; an enabled one runs now.',
  },
  denied: {
    title: 'The consent was declined',
    description:
      'Google gave no access, and the source stays as it was. Connect it again from its card to give access.',
  },
  invalid: {
    title: 'This consent cannot be completed',
    description:
      'It was started by another session, or more than ten minutes ago, or its source is gone. Connect the source again from its card.',
  },
  refused: {
    title: 'Google refused the authorization',
    description:
      'Check the client id and secret in the Settings, and the redirect URI registered with the client, then connect the source again.',
  },
  missing_scope: {
    title: 'Read access to Drive was not given',
    description:
      'The consent page lets the access to Drive be unticked: connect the source again and keep it ticked.',
  },
};

const ANSWER_PARAMETERS = ['code', 'state', 'error'] as const;

/**
 * What Google answered, as the server put it in the address: undefined when nothing is
 * there, `unreadable` when the contract refuses it.
 */
const answerOf = (search: string): GoogleConsentAnswer | 'unreadable' | undefined => {
  const query = new URLSearchParams(search);
  const given = ANSWER_PARAMETERS.flatMap((name) => {
    const value = query.get(name);
    return value === null || value === '' ? [] : [[name, value] as const];
  });
  if (given.length === 0) return undefined;
  const parsed = googleConsentAnswerSchema.safeParse(Object.fromEntries(given));
  return parsed.success ? parsed.data : 'unreadable';
};

// A code is single use: one query per answer, and nothing that could send it twice. React
// runs the effects of StrictMode twice, and the cache answers the second. A query without
// data counts as stale whatever its `staleTime`: after a failed post, a reconnection would
// post the code again, and so would a new mount unless a query in error is not retried on
// mount (`refetchOnMount` only applies to a query that has data).
const useCompleteConsent = (answer: GoogleConsentAnswer) => {
  const client = useClient();
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: ['google-consent', answer],
    queryFn: async () => {
      const result = await client.completeGoogleConsent(answer);
      await queryClient.invalidateQueries({ queryKey: SOURCES_QUERY_KEY });
      return result;
    },
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    retry: false,
    retryOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });
};

// Once the answer is read, it leaves the address and the history.
const useClearedAddress = (read: boolean): void => {
  const navigate = useNavigate();
  useEffect(() => {
    if (read) void navigate({ search: '' }, { replace: true });
  }, [read, navigate]);
};

const ConsentOutcome = ({ answer }: { readonly answer: GoogleConsentAnswer }) => {
  const completion = useCompleteConsent(answer);
  useClearedAddress(!completion.isPending);

  if (completion.isPending) {
    return <p className="text-sm text-muted-foreground">Completing the consent...</p>;
  }
  if (completion.isError) {
    return <ErrorAlert error={completion.error} title="Consent not completed" />;
  }
  const { outcome } = completion.data;
  const text = OUTCOMES[outcome];
  const connected = outcome === 'connected';
  return (
    <Alert variant={connected ? 'default' : 'destructive'}>
      {connected ? <CircleCheckIcon /> : <CircleAlertIcon />}
      <AlertTitle>{text.title}</AlertTitle>
      <AlertDescription>{text.description}</AlertDescription>
    </Alert>
  );
};

const NoConsent = () => (
  <Alert>
    <CircleAlertIcon />
    <AlertTitle>No consent to complete</AlertTitle>
    <AlertDescription>
      This page completes the consent Google sends back after a Drive source is connected.
    </AlertDescription>
  </Alert>
);

const UnreadableConsent = () => {
  useClearedAddress(true);
  return (
    <Alert variant="destructive">
      <CircleAlertIcon />
      <AlertTitle>The answer of Google cannot be read</AlertTitle>
      <AlertDescription>Connect the source again from the Sources page.</AlertDescription>
    </Alert>
  );
};

const Consent = ({ answer }: { readonly answer: ReturnType<typeof answerOf> }) => {
  if (answer === undefined) return <NoConsent />;
  if (answer === 'unreadable') return <UnreadableConsent />;
  return <ConsentOutcome answer={answer} />;
};

/** Where the server sends the browser back from Google: completes the consent once. */
export const GoogleConsentPage = () => {
  const { search } = useLocation();
  // Read once: the address is cleared as soon as the server has the answer.
  const [answer] = useState(() => answerOf(search));
  return (
    <>
      <PageHeader title="Google Drive" description="The end of a connection to Google." />
      <div className="flex max-w-2xl flex-col gap-4" role="status">
        <Consent answer={answer} />
      </div>
      <Button variant="outline" className="mt-4 self-start" asChild>
        <Link to={SOURCES_PATH}>Back to the sources</Link>
      </Button>
    </>
  );
};
