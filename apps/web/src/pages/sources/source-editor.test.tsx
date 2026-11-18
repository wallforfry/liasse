import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeServer, json, jsonBody, renderApp } from '../../test/render.test-helper.tsx';
import { isCreate, isPatch, SOURCE, sourcesServer } from './sources.test-helper.ts';

type User = ReturnType<typeof userEvent.setup>;

const type = async (user: User, label: string, text: string): Promise<void> => {
  const input = screen.getByLabelText(label);
  await user.clear(input);
  await user.click(input);
  await user.paste(text);
};

const save = async (user: User): Promise<void> => {
  await user.click(screen.getByRole('button', { name: 'Save the source' }));
};

describe('the form of a source', () => {
  it('is reached from the sources page', async () => {
    renderApp('/sources', fakeServer(sourcesServer({ sources: [] })).fetch);
    await userEvent.setup().click(await screen.findByRole('link', { name: 'Add a source' }));
    expect(await screen.findByRole('heading', { name: 'New source' })).toBeInTheDocument();
  });

  it('creates an IMAP source with its password', async () => {
    const server = fakeServer(sourcesServer());
    renderApp('/sources/new', server.fetch);
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: 'New source' });
    await type(user, 'Name', 'Synthetic bills');
    await type(user, 'Host', 'imap.example.test');
    await type(user, 'User name', 'owner@example.test');
    await type(user, 'mailbox password', 'synthetic-app-password');
    await type(user, 'Mailboxes', 'INBOX\n\nBills\n');
    await type(user, 'Start date', '2026-01-01');
    await type(user, 'Subject contains (optional)', 'Invoice');
    await user.click(screen.getByLabelText('Include messages without attachments'));
    await type(user, 'Hint (optional)', 'Bills of the flat');
    await user.click(screen.getByLabelText(/^Private/u));
    await save(user);

    expect(await screen.findByRole('heading', { name: 'Sources' })).toBeInTheDocument();
    expect(jsonBody(server.requests.find(isCreate))).toEqual({
      kind: 'imap',
      name: 'Synthetic bills',
      enabled: true,
      poll_interval_minutes: 5,
      config: {
        host: 'imap.example.test',
        port: 993,
        security: 'tls',
        username: 'owner@example.test',
        mailboxes: ['INBOX', 'Bills'],
        start_date: '2026-01-01',
        subject: 'Invoice',
        include_messages_without_attachments: true,
      },
      secret: { action: 'replace', value: 'synthetic-app-password' },
      hint: 'Bills of the flat',
      private: true,
    });
  });

  it('marks the fields the schema refuses, and sends nothing', async () => {
    const server = fakeServer(sourcesServer());
    renderApp('/sources/new', server.fetch);
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: 'New source' });
    await type(user, 'Name', 'Synthetic bills');
    await type(user, 'Port', '70000');
    await type(user, 'Mailboxes', 'INBOX\nINBOX');
    await save(user);

    expect(
      await screen.findByText('Some fields are not valid: see the marked fields.'),
    ).toBeInTheDocument();
    for (const label of [
      'Host',
      'Port',
      'User name',
      'Mailboxes',
      'Start date',
      'mailbox password',
    ]) {
      expect(screen.getByLabelText(label)).toHaveAttribute('aria-invalid', 'true');
    }
    expect(screen.getByText('a mailbox is named twice')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).not.toHaveAttribute('aria-invalid');
    expect(server.requests.some(isCreate)).toBe(false);
  });

  it('marks the fields a refused save names', async () => {
    const refusal = () =>
      json(
        {
          error: {
            code: 'invalid_request',
            message: 'The request is not valid.',
            request_id: 'req_synthetic',
            issues: [{ path: 'config.host', message: 'Unknown host.' }],
          },
        },
        400,
      );
    const server = fakeServer(sourcesServer({ saved: refusal }));
    renderApp(`/sources/${SOURCE.id}/edit`, server.fetch);
    const user = userEvent.setup();

    await screen.findByDisplayValue('imap.example.test');
    await save(user);

    expect(await screen.findByText('Unknown host.')).toBeInTheDocument();
    expect(screen.getByLabelText('Host')).toHaveAttribute('aria-invalid', 'true');
  });

  it('warns that the password crosses the network in clear without TLS', async () => {
    renderApp('/sources/new', fakeServer(sourcesServer()).fetch);
    const user = userEvent.setup();

    const security = await screen.findByRole('combobox', { name: 'Security' });
    expect(screen.queryByText(/crosses the network in clear/u)).not.toBeInTheDocument();
    security.focus();
    await user.keyboard('{Enter}');
    await user.click(await screen.findByRole('option', { name: 'none' }));

    expect(
      await screen.findByText('The password crosses the network in clear'),
    ).toBeInTheDocument();
  });

  it('shows the hint for Gmail', async () => {
    renderApp('/sources/new', fakeServer(sourcesServer()).fetch);

    const server = within(await screen.findByRole('region', { name: 'Server' }));
    expect(server.getByText(/app password/u)).toHaveTextContent('imap.gmail.com');
    expect(server.getByText(/app password/u)).toHaveTextContent('a label is a folder');
  });

  it('edits a source, its password kept when untouched', async () => {
    const server = fakeServer(sourcesServer());
    renderApp(`/sources/${SOURCE.id}/edit`, server.fetch);
    const user = userEvent.setup();

    expect(await screen.findByDisplayValue('imap.example.test')).toBeInTheDocument();
    const password = within(screen.getByRole('group', { name: 'Password' }));
    expect(password.getByText('Set')).toBeInTheDocument();
    expect(password.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Mailboxes')).toHaveValue('INBOX\nBills');
    expect(screen.getByLabelText('Hint (optional)')).toHaveValue('Bills of the flat');
    await type(user, 'Minutes between runs', '30');
    await user.clear(screen.getByLabelText('Hint (optional)'));
    await save(user);

    await waitFor(() => {
      expect(server.requests.some(isPatch)).toBe(true);
    });
    expect(jsonBody(server.requests.find(isPatch))).toEqual({
      kind: 'imap',
      name: SOURCE.name,
      enabled: true,
      poll_interval_minutes: 30,
      config: { ...SOURCE.config },
      secret: { action: 'keep' },
      hint: null,
      private: false,
    });
  });

  it('asks for the password again when the host changes, and sends it', async () => {
    const server = fakeServer(sourcesServer());
    renderApp(`/sources/${SOURCE.id}/edit`, server.fetch);
    const user = userEvent.setup();

    await screen.findByDisplayValue('imap.example.test');
    await type(user, 'Host', 'imap.other.example.test');
    expect(screen.getByLabelText('mailbox password')).toHaveValue('');
    expect(screen.getByText(/given for the former server/u)).toBeInTheDocument();
    await save(user);
    expect(screen.getByLabelText('mailbox password')).toHaveAttribute('aria-invalid', 'true');
    expect(server.requests.some(isPatch)).toBe(false);

    await type(user, 'mailbox password', 'synthetic-new-password');
    await save(user);
    await waitFor(() => {
      expect(server.requests.some(isPatch)).toBe(true);
    });
    expect(jsonBody(server.requests.find(isPatch))).toMatchObject({
      config: { host: 'imap.other.example.test' },
      secret: { action: 'replace', value: 'synthetic-new-password' },
    });
  });

  it('refuses to keep the stored password for another security', async () => {
    const server = fakeServer(sourcesServer());
    renderApp(`/sources/${SOURCE.id}/edit`, server.fetch);
    const user = userEvent.setup();

    const security = await screen.findByRole('combobox', { name: 'Security' });
    security.focus();
    await user.keyboard('{Enter}');
    await user.click(await screen.findByRole('option', { name: 'starttls' }));
    await user.click(
      screen.getByRole('button', { name: 'Cancel the change of the mailbox password' }),
    );
    await save(user);

    expect(
      await screen.findByText(
        'The stored password was given for the former server: enter it again.',
      ),
    ).toBeInTheDocument();
    expect(server.requests.some(isPatch)).toBe(false);
  });

  it('keeps the password untouched when the host comes back before anything is typed', async () => {
    renderApp(`/sources/${SOURCE.id}/edit`, fakeServer(sourcesServer()).fetch);
    const user = userEvent.setup();

    await screen.findByDisplayValue('imap.example.test');
    await type(user, 'Host', 'imap.other.example.test');
    await type(user, 'Host', 'imap.example.test');

    expect(screen.queryByLabelText('mailbox password')).not.toBeInTheDocument();
    expect(screen.queryByText(/given for the former server/u)).not.toBeInTheDocument();
  });

  it('marks the password when the server asks for it again', async () => {
    const refusal = () =>
      json(
        {
          error: {
            code: 'source_secret_required',
            message: 'A new host or connection security would receive the stored password.',
            request_id: 'req_synthetic',
          },
        },
        400,
      );
    renderApp(`/sources/${SOURCE.id}/edit`, fakeServer(sourcesServer({ saved: refusal })).fetch);
    const user = userEvent.setup();

    await screen.findByDisplayValue('imap.example.test');
    await save(user);

    const password = within(screen.getByRole('group', { name: 'Password' }));
    expect(
      await password.findByText(
        'The stored password was given for the former server: enter it again.',
      ),
    ).toBeInTheDocument();
  });
});
