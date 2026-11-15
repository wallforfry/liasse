import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '@liasse/contract/domain';
import { useMutation } from '@tanstack/react-query';
import { type SubmitEvent, useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import { unwrap } from '../../api/auth-result.ts';
import { useAuth } from '../../api/session.ts';
import { ErrorAlert } from '../../components/error-alert.tsx';
import { PageHeader } from '../../components/page-header.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Card, CardContent } from '../../components/ui/card.tsx';
import { Input } from '../../components/ui/input.tsx';
import { Label } from '../../components/ui/label.tsx';

interface PasswordChange {
  readonly currentPassword: string;
  readonly newPassword: string;
}

const EMPTY = { current: '', next: '', confirmation: '' } as const;

/** Why the new password cannot be sent yet, or undefined when it can. */
const problemOf = (next: string, confirmation: string): string | undefined => {
  if (next.length < MIN_PASSWORD_LENGTH) {
    return `The new password needs at least ${String(MIN_PASSWORD_LENGTH)} characters.`;
  }
  if (next.length > MAX_PASSWORD_LENGTH) {
    return `The new password has at most ${String(MAX_PASSWORD_LENGTH)} characters.`;
  }
  if (confirmation !== next) return 'The confirmation differs from the new password.';
  return undefined;
};

export const ChangePasswordPage = () => {
  const auth = useAuth();
  const [fields, setFields] = useState<Readonly<Record<keyof typeof EMPTY, string>>>(EMPTY);
  const change = useMutation({
    mutationFn: async ({ currentPassword, newPassword }: PasswordChange) =>
      unwrap(
        z.unknown(),
        await auth.changePassword({ currentPassword, newPassword, revokeOtherSessions: true }),
      ),
    onSuccess: () => {
      setFields(EMPTY);
      toast.success('Your password was changed. Your other sessions are logged out.');
    },
  });
  const problem = problemOf(fields.next, fields.confirmation);
  const field = (name: keyof typeof EMPTY) => ({
    value: fields[name],
    onChange: (event: { readonly target: { readonly value: string } }) => {
      setFields((previous) => ({ ...previous, [name]: event.target.value }));
    },
  });

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    change.mutate({ currentPassword: fields.current, newPassword: fields.next });
  };

  return (
    <>
      <PageHeader
        title="Change password"
        description="Every other session of your account is logged out once the password changes."
      />
      <Card className="max-w-md">
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={submit}>
            {change.error === null ? null : (
              <ErrorAlert error={change.error} title="Password not changed" />
            )}
            <div className="grid gap-2">
              <Label htmlFor="current-password">Current password</Label>
              <Input
                id="current-password"
                type="password"
                autoComplete="current-password"
                required
                maxLength={MAX_PASSWORD_LENGTH}
                {...field('current')}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="new-password">New password</Label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                required
                maxLength={MAX_PASSWORD_LENGTH}
                aria-describedby="new-password-rule"
                {...field('next')}
              />
              <p id="new-password-rule" className="text-sm text-muted-foreground">
                {String(MIN_PASSWORD_LENGTH)} to {String(MAX_PASSWORD_LENGTH)} characters.
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="confirm-password">Confirm the new password</Label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                required
                maxLength={MAX_PASSWORD_LENGTH}
                {...field('confirmation')}
              />
              {fields.confirmation === '' || problem === undefined ? null : (
                <p className="text-sm text-destructive">{problem}</p>
              )}
            </div>
            <Button
              type="submit"
              className="self-start"
              disabled={change.isPending || fields.current === '' || problem !== undefined}
            >
              {change.isPending ? 'Changing...' : 'Change password'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </>
  );
};
