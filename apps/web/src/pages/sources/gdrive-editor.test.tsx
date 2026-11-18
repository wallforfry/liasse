import { screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeServer, jsonBody, renderApp } from '../../test/render.test-helper.tsx';
import { DRIVE_SOURCE, isCreate, isPatch, sourcesServer } from './sources.test-helper.ts';

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

const openDriveForm = async (user: User): Promise<void> => {
  await user.click(await screen.findByRole('tab', { name: 'Google Drive folder' }));
  await screen.findByLabelText('Folder');
};

describe('the form of a Drive source', () => {
  it('opens on the mailbox form, the Drive one a tab away', async () => {
    renderApp('/sources/new', fakeServer(sourcesServer()).fetch);
    const user = userEvent.setup();

    expect(await screen.findByLabelText('Host')).toBeInTheDocument();
    expect(screen.queryByLabelText('Folder')).not.toBeInTheDocument();
    await openDriveForm(user);
    expect(screen.queryByLabelText('Host')).not.toBeInTheDocument();
    expect(screen.queryByText(/password/iu, { selector: 'form *' })).not.toBeInTheDocument();
  });

  it('creates a source from the address of a folder, without a secret', async () => {
    const server = fakeServer(sourcesServer({ sources: [DRIVE_SOURCE] }));
    renderApp('/sources/new', server.fetch);
    const user = userEvent.setup();

    await openDriveForm(user);
    await type(user, 'Name', 'Synthetic scans');
    await type(
      user,
      'Folder',
      'https://drive.google.com/drive/u/1/folders/1SyntheticFolder_id-42?usp=sharing',
    );
    await type(user, 'Hint (optional)', 'Scans of the flat');
    await save(user);

    expect(
      await screen.findByText('The source is saved: connect it with Google to run it.'),
    ).toBeInTheDocument();
    expect(jsonBody(server.requests.find(isCreate))).toEqual({
      kind: 'gdrive',
      name: 'Synthetic scans',
      enabled: true,
      poll_interval_minutes: 5,
      config: { folder_id: '1SyntheticFolder_id-42' },
      hint: 'Scans of the flat',
      private: false,
    });
  });

  it('takes root for the whole of My Drive', async () => {
    const server = fakeServer(sourcesServer({ sources: [DRIVE_SOURCE] }));
    renderApp('/sources/new', server.fetch);
    const user = userEvent.setup();

    await openDriveForm(user);
    await type(user, 'Name', 'Everything');
    await type(user, 'Folder', 'root');
    await save(user);

    await waitFor(() => {
      expect(server.requests.some(isCreate)).toBe(true);
    });
    expect(jsonBody(server.requests.find(isCreate))).toMatchObject({
      config: { folder_id: 'root' },
    });
  });

  it('refuses an address that names no folder, and sends nothing', async () => {
    const server = fakeServer(sourcesServer());
    renderApp('/sources/new', server.fetch);
    const user = userEvent.setup();

    await openDriveForm(user);
    await type(user, 'Name', 'Synthetic scans');
    await type(user, 'Folder', 'https://drive.google.com/file/d/1SyntheticFile/view');
    await save(user);

    expect(screen.getByLabelText('Folder')).toHaveAttribute('aria-invalid', 'true');
    expect(
      screen.getByText('a Drive folder id: the last part of the address of the folder'),
    ).toBeInTheDocument();
    expect(server.requests.some(isCreate)).toBe(false);
  });

  it('edits a source: sends the fields it changed, and never a secret', async () => {
    const server = fakeServer(sourcesServer({ sources: [DRIVE_SOURCE] }));
    renderApp(`/sources/${DRIVE_SOURCE.id}/edit`, server.fetch);
    const user = userEvent.setup();

    expect(await screen.findByDisplayValue('1SyntheticFolder_id-42')).toBeInTheDocument();
    expect(screen.queryByText(/password/iu, { selector: 'form *' })).not.toBeInTheDocument();
    await type(user, 'Minutes between runs', '30');
    await save(user);

    await waitFor(() => {
      expect(server.requests.some(isPatch)).toBe(true);
    });
    expect(jsonBody(server.requests.find(isPatch))).toEqual({
      kind: 'gdrive',
      poll_interval_minutes: 30,
    });
  });

  it('sends the folder once it changes', async () => {
    const server = fakeServer(sourcesServer({ sources: [DRIVE_SOURCE] }));
    renderApp(`/sources/${DRIVE_SOURCE.id}/edit`, server.fetch);
    const user = userEvent.setup();

    await screen.findByDisplayValue('1SyntheticFolder_id-42');
    await type(user, 'Folder', 'https://drive.google.com/drive/folders/1OtherFolder');
    await save(user);

    await waitFor(() => {
      expect(server.requests.some(isPatch)).toBe(true);
    });
    expect(jsonBody(server.requests.find(isPatch))).toEqual({
      kind: 'gdrive',
      config: { folder_id: '1OtherFolder' },
    });
  });
});
