import { useMutation, useQuery } from '@tanstack/react-query';
import { CircleAlertIcon, KeyRoundIcon } from 'lucide-react';
import { useLocation } from 'react-router';
import { unwrap } from '../api/auth-result.ts';
import { publicClientSchema, redirectAnswerSchema } from '../api/auth-schemas.ts';
import { useAuth, useSession } from '../api/session.ts';
import { ErrorAlert } from '../components/error-alert.tsx';
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert.tsx';
import { Badge } from '../components/ui/badge.tsx';
import { Button } from '../components/ui/button.tsx';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '../components/ui/card.tsx';
import { Skeleton } from '../components/ui/skeleton.tsx';

const scopesOf = (scope: string | null): readonly string[] =>
  (scope ?? '').split(' ').filter((name) => name !== '');

const ClientName = ({ clientId }: { readonly clientId: string }) => {
  const auth = useAuth();
  const client = useQuery({
    queryKey: ['oauth-client', clientId],
    queryFn: async () =>
      unwrap(
        publicClientSchema,
        await auth.oauth2.publicClient({ query: { client_id: clientId } }),
      ),
  });
  if (client.isPending) return <Skeleton className="h-6 w-40" />;
  const name = client.data?.client_name ?? '';
  return <span className="font-semibold break-all">{name === '' ? clientId : name}</span>;
};

/** Where the auth server sends the person to let an OAuth client, an MCP agent, in. */
export const ConsentPage = () => {
  const auth = useAuth();
  const { followRedirect } = useSession();
  const query = new URLSearchParams(useLocation().search);
  const clientId = query.get('client_id');
  const scopes = scopesOf(query.get('scope'));
  const decide = useMutation({
    mutationFn: async (accept: boolean) =>
      unwrap(redirectAnswerSchema, await auth.oauth2.consent({ accept })),
    onSuccess: ({ url }) => {
      followRedirect(url);
    },
  });

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <KeyRoundIcon className="size-5" />
          </div>
          <CardTitle className="text-xl">Allow access to Liasse?</CardTitle>
          <CardDescription>
            An application asks to act on your documents with your account.
          </CardDescription>
        </CardHeader>
        {clientId === null ? (
          <CardContent>
            <Alert variant="destructive">
              <CircleAlertIcon />
              <AlertTitle>No authorization in progress</AlertTitle>
              <AlertDescription>
                This page continues an authorization started by an application.
              </AlertDescription>
            </Alert>
          </CardContent>
        ) : (
          <>
            <CardContent className="flex flex-col gap-4">
              {decide.error === null ? null : (
                <ErrorAlert error={decide.error} title="Not recorded" />
              )}
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Application</p>
                <ClientName clientId={clientId} />
              </div>
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">It asks for</p>
                {scopes.length === 0 ? (
                  <p className="text-sm">No particular permission.</p>
                ) : (
                  <ul className="flex flex-wrap gap-2" aria-label="Requested permissions">
                    {scopes.map((scope) => (
                      <li key={scope}>
                        <Badge variant="secondary">{scope}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </CardContent>
            <CardFooter className="flex justify-end gap-2">
              <Button
                variant="outline"
                disabled={decide.isPending || decide.isSuccess}
                onClick={() => {
                  decide.mutate(false);
                }}
              >
                Deny
              </Button>
              <Button
                disabled={decide.isPending || decide.isSuccess}
                onClick={() => {
                  decide.mutate(true);
                }}
              >
                Allow
              </Button>
            </CardFooter>
          </>
        )}
      </Card>
    </main>
  );
};
