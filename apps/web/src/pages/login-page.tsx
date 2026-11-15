import { FolderArchiveIcon } from 'lucide-react';
import { type SubmitEvent, useState } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useSession } from '../api/session.ts';
import { ErrorAlert } from '../components/error-alert.tsx';
import { Button } from '../components/ui/button.tsx';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/card.tsx';
import { Input } from '../components/ui/input.tsx';
import { Label } from '../components/ui/label.tsx';

const HOME = '/documents';

// Where the person was sent from, as `RequireSession` records it.
const returnPathOf = (state: unknown): string =>
  typeof state === 'object' &&
  state !== null &&
  'from' in state &&
  typeof state.from === 'string' &&
  state.from.startsWith('/')
    ? state.from
    : HOME;

export const LoginPage = () => {
  const { status, logIn } = useSession();
  const location = useLocation();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(undefined);
  const [pending, setPending] = useState(false);

  if (status === 'signed_in') return <Navigate to={returnPathOf(location.state)} replace />;

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    // Once logged in, the session status changes and the page renders the redirection.
    logIn(password).catch((caught: unknown) => {
      setError(caught);
      setPending(false);
    });
  };

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <FolderArchiveIcon className="size-5" />
          </div>
          <CardTitle className="text-xl">Log in to Liasse</CardTitle>
          <CardDescription>Enter the password of this server.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={submit}>
            {error === undefined ? null : <ErrorAlert error={error} title="Not logged in" />}
            <div className="grid gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                autoFocus
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                }}
              />
            </div>
            <Button type="submit" disabled={pending || password === ''}>
              {pending ? 'Logging in...' : 'Log in'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
};
