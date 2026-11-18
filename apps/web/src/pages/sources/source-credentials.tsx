import type { SourceKind } from '@liasse/contract/domain';
import { LiasseApiError, type Source } from '@liasse/sdk';
import { CircleAlertIcon, InfoIcon, LinkIcon } from 'lucide-react';
import { Link } from 'react-router';
import { ErrorAlert } from '../../components/error-alert.tsx';
import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert.tsx';
import { Button } from '../../components/ui/button.tsx';
import { SETTINGS_PATH } from '../../layout/navigation.ts';
import { needsGoogleConsent, useConnectGoogle } from './google-consent.ts';

interface Notice {
  readonly title: string;
  readonly description: string;
  /** Polling stopped on a refusal, rather than waiting for a first consent. */
  readonly stopped: boolean;
}

/** What the card says of credentials that were refused or no longer open, per kind. */
const NOTICES: Readonly<
  Record<SourceKind, { readonly refused: Notice; readonly unreadable: Notice }>
> = {
  imap: {
    refused: {
      title: 'Needs attention: the password was refused',
      description:
        'Polling stopped. Edit the source and save it with a working password to resume.',
      stopped: true,
    },
    unreadable: {
      title: 'The password is unreadable',
      description:
        'It was sealed under another AUTH_SECRET. Edit the source and give the password again.',
      stopped: true,
    },
  },
  gdrive: {
    refused: {
      title: 'Needs attention: Google refused the authorization',
      description: 'Polling stopped. Connect the source with Google again to resume.',
      stopped: true,
    },
    unreadable: {
      title: 'The authorization is unreadable',
      description: 'It was sealed under another AUTH_SECRET. Connect the source with Google again.',
      stopped: true,
    },
  },
};

const NOT_CONNECTED: Notice = {
  title: 'Not connected to Google',
  description: 'The source is not run until it is connected with Google.',
  stopped: false,
};

const noticeOf = (source: Source): Notice | undefined => {
  if (source.needs_attention) return NOTICES[source.kind].refused;
  if (source.secret === 'unreadable') return NOTICES[source.kind].unreadable;
  return source.kind === 'gdrive' && source.secret === 'unset' ? NOT_CONNECTED : undefined;
};

const GoogleClientMissing = () => (
  <Alert variant="destructive">
    <CircleAlertIcon />
    <AlertTitle>No Google client yet</AlertTitle>
    <AlertDescription>
      <p>
        Give the client id and secret of your Google Cloud project in the{' '}
        <Link to={SETTINGS_PATH} className="underline underline-offset-4">
          Settings
        </Link>{' '}
        first.
      </p>
    </AlertDescription>
  </Alert>
);

const ConnectError = ({ error }: { readonly error: Error | null }) => {
  if (error === null) return null;
  if (error instanceof LiasseApiError && error.code === 'google_client_missing') {
    return <GoogleClientMissing />;
  }
  return <ErrorAlert error={error} title="Not connected" />;
};

const ConnectGoogle = ({ source }: { readonly source: Source }) => {
  const connect = useConnectGoogle(source.id);
  const again = source.needs_attention || source.secret === 'unreadable';
  return (
    <div className="flex flex-col gap-2">
      <Button
        size="sm"
        className="self-start"
        disabled={connect.isPending}
        onClick={() => {
          connect.mutate();
        }}
      >
        <LinkIcon />
        {again ? 'Connect again' : 'Connect with Google'}
      </Button>
      <ConnectError error={connect.error} />
    </div>
  );
};

/**
 * Whether the credentials of a source were refused or no longer open, and for a Drive
 * source not connected yet, the way to its consent.
 */
export const SourceCredentials = ({ source }: { readonly source: Source }) => {
  const notice = noticeOf(source);
  return (
    <>
      {notice === undefined ? null : (
        <Alert variant={notice.stopped ? 'destructive' : 'default'}>
          {notice.stopped ? <CircleAlertIcon /> : <InfoIcon />}
          <AlertTitle>{notice.title}</AlertTitle>
          <AlertDescription>{notice.description}</AlertDescription>
        </Alert>
      )}
      {needsGoogleConsent(source) ? <ConnectGoogle source={source} /> : null}
    </>
  );
};
