import { MIN_PASSWORD_LENGTH } from '@liasse/contract/domain';
import { screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  type Answer,
  authError,
  authPath,
  fakeServer,
  json,
  jsonBody,
  LIVE_SESSION,
  renderApp,
} from '../../test/render.test-helper.tsx';

const CURRENT = 'synthetic-current-password';
const NEXT = 'synthetic-new-password';

const changePassword =
  (answer: () => Response): Answer =>
  (request) =>
    request.path === authPath('/change-password') ? answer() : undefined;

const fill = async (current: string, next: string, confirmation: string) => {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Current password'), current);
  await user.type(screen.getByLabelText('New password'), next);
  await user.type(screen.getByLabelText('Confirm the new password'), confirmation);
  return user;
};

describe('the password change', () => {
  it('sends both passwords, logs out the other sessions and says it is done', async () => {
    const server = fakeServer(
      changePassword(() => json({ token: 'synthetic-token', user: LIVE_SESSION.user })),
    );
    renderApp('/account/password', server.fetch);
    const user = await fill(CURRENT, NEXT, NEXT);
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByText(/Your password was changed/)).toBeInTheDocument();
    const change = server.requests.find(({ path }) => path === authPath('/change-password'));
    expect(change?.method).toBe('POST');
    expect(jsonBody(change)).toEqual({
      currentPassword: CURRENT,
      newPassword: NEXT,
      revokeOtherSessions: true,
    });
    expect(screen.getByLabelText('Current password')).toHaveValue('');
  });

  it('shows the refusal of a wrong current password', async () => {
    const server = fakeServer(
      changePassword(() => authError(400, 'INVALID_PASSWORD', 'Invalid password')),
    );
    renderApp('/account/password', server.fetch);
    const user = await fill('wrong-current-password', NEXT, NEXT);
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByText('Invalid password')).toBeInTheDocument();
    expect(screen.getByText('Password not changed')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Change password' })).toBeInTheDocument();
  });

  it('sends nothing while the new password is too short or differs from its confirmation', async () => {
    const server = fakeServer();
    renderApp('/account/password', server.fetch);
    const short = 'x'.repeat(MIN_PASSWORD_LENGTH - 1);
    const user = await fill(CURRENT, short, short);

    expect(screen.getByText(/needs at least 12 characters/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change password' })).toBeDisabled();
    await user.type(screen.getByLabelText('New password'), 'yz');
    expect(screen.getByText('The confirmation differs from the new password.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change password' })).toBeDisabled();
    expect(server.requests.some(({ path }) => path === authPath('/change-password'))).toBe(false);
  });
});
