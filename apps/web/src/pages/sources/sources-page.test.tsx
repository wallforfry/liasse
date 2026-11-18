import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { errorBody, fakeServer, jsonBody, renderApp } from '../../test/render.test-helper.tsx';
import {
  isCheck,
  isDelete,
  isList,
  isPatch,
  isRun,
  SOURCE,
  sourcesServer,
} from './sources.test-helper.ts';

const card = async (name: string = SOURCE.name) =>
  within(await screen.findByRole('region', { name }));

describe('the sources page', () => {
  it('is reached from the navigation', async () => {
    renderApp('/documents', fakeServer(sourcesServer()).fetch);
    await userEvent.setup().click(await screen.findByRole('link', { name: 'Sources' }));
    expect(await screen.findByRole('heading', { name: 'Sources' })).toBeInTheDocument();
  });

  it('shows a card per source with what its last run did', async () => {
    renderApp('/sources', fakeServer(sourcesServer()).fetch);

    const source = await card();
    expect(
      source.getByText('owner@example.test on imap.example.test, reading INBOX, Bills', {
        exact: false,
      }),
    ).toBeInTheDocument();
    expect(source.getByRole('switch', { name: 'Enabled' })).toBeChecked();
    expect(
      source.getByText(
        'Last run finished 2026-11-18 08:01 UTC: 3 ingested, 1 duplicate, 1 skipped.',
      ),
    ).toBeInTheDocument();
    expect(source.getByText('Hint:').parentElement).toHaveTextContent('Hint: Bills of the flat');
    expect(source.queryByText('Private')).not.toBeInTheDocument();
    const skipped = within(source.getByRole('list', { name: 'Skipped items' }));
    expect(skipped.getByRole('listitem')).toHaveTextContent(
      'Huge scan.eml: The file is over max_file_size.',
    );
    expect(source.queryByText(/Needs attention/u)).not.toBeInTheDocument();
    expect(source.getByRole('button', { name: 'Run now' })).toBeEnabled();
  });

  it('says when the password was refused, and offers no run', async () => {
    const refused = {
      ...SOURCE,
      needs_attention: true,
      last_run: {
        ...SOURCE.last_run,
        ingested: 0,
        duplicates: 0,
        skipped: 0,
        skipped_items: [],
        error: { kind: 'credentials', message: 'Authentication failed.' },
      },
    };
    renderApp('/sources', fakeServer(sourcesServer({ sources: [refused] })).fetch);

    const source = await card();
    expect(source.getByText('Needs attention: the password was refused')).toBeInTheDocument();
    expect(source.getByText('The run stopped: the password was refused')).toBeInTheDocument();
    expect(source.getByText('Authentication failed.')).toBeInTheDocument();
    expect(source.getByRole('button', { name: 'Run now' })).toBeDisabled();
  });

  it('marks a private source', async () => {
    const hidden = { ...SOURCE, private: true, hint: null };
    renderApp('/sources', fakeServer(sourcesServer({ sources: [hidden] })).fetch);

    const source = await card();
    expect(source.getByText('Private')).toBeInTheDocument();
    expect(source.queryByText('Hint:')).not.toBeInTheDocument();
  });

  it('says when the stored password no longer opens', async () => {
    const sealed = { ...SOURCE, secret: 'unreadable', last_run: null };
    renderApp('/sources', fakeServer(sourcesServer({ sources: [sealed] })).fetch);

    const source = await card();
    expect(source.getByText('The password is unreadable')).toBeInTheDocument();
    expect(source.getByText('Never run yet.')).toBeInTheDocument();
  });

  it('offers no run for a disabled source', async () => {
    const disabled = { ...SOURCE, enabled: false };
    renderApp('/sources', fakeServer(sourcesServer({ sources: [disabled] })).fetch);

    const source = await card();
    expect(source.getByRole('switch', { name: 'Enabled' })).not.toBeChecked();
    expect(source.getByRole('button', { name: 'Run now' })).toBeDisabled();
  });

  it('says that WATCH_DIR stays in the environment when there is no source', async () => {
    renderApp('/sources', fakeServer(sourcesServer({ sources: [] })).fetch);

    expect(await screen.findByText(/^No source yet/u)).toBeInTheDocument();
    expect(screen.getByText(/WATCH_DIR is not a source here/u)).toBeInTheDocument();
  });

  it('runs a source now', async () => {
    const server = fakeServer(sourcesServer());
    renderApp('/sources', server.fetch);

    await userEvent.setup().click((await card()).getByRole('button', { name: 'Run now' }));

    expect(await screen.findByText('A run is queued.')).toBeInTheDocument();
    expect(server.requests.filter(isRun)).toHaveLength(1);
  });

  it('shows the refusal of a run', async () => {
    const server = fakeServer(
      sourcesServer({
        run: () => errorBody(409, 'source_disabled', 'The source is disabled: enable it first.'),
      }),
    );
    renderApp('/sources', server.fetch);

    await userEvent.setup().click((await card()).getByRole('button', { name: 'Run now' }));

    expect(await screen.findByText('The source is disabled: enable it first.')).toBeInTheDocument();
  });

  it('shows the first items a check finds', async () => {
    const server = fakeServer(sourcesServer());
    renderApp('/sources', server.fetch);

    const source = await card();
    await userEvent.setup().click(source.getByRole('button', { name: 'Check' }));

    const items = within(await source.findByRole('list', { name: 'Next items' }));
    expect(items.getByRole('listitem')).toHaveTextContent('Invoice 42.eml');
    expect(server.requests.filter(isCheck)).toHaveLength(1);
  });

  it('shows why a check failed', async () => {
    const check = { ok: false, error: { kind: 'transient', message: 'Connection timed out.' } };
    renderApp('/sources', fakeServer(sourcesServer({ check })).fetch);

    const source = await card();
    await userEvent.setup().click(source.getByRole('button', { name: 'Check' }));

    expect(await source.findByText('Check failed: Connection timed out.')).toBeInTheDocument();
  });

  it('disables a source with its switch', async () => {
    const server = fakeServer(sourcesServer());
    renderApp('/sources', server.fetch);

    await userEvent.setup().click((await card()).getByRole('switch', { name: 'Enabled' }));

    await waitFor(() => {
      expect(server.requests.some(isPatch)).toBe(true);
    });
    expect(jsonBody(server.requests.find(isPatch))).toEqual({ kind: 'imap', enabled: false });
  });

  it('deletes a source once confirmed', async () => {
    const server = fakeServer(sourcesServer());
    renderApp('/sources', server.fetch);
    const user = userEvent.setup();

    await user.click((await card()).getByRole('button', { name: 'Delete' }));
    const dialog = within(await screen.findByRole('alertdialog'));
    expect(dialog.getByText(/The documents it brought stay in Liasse/u)).toBeInTheDocument();
    expect(server.requests.some(isDelete)).toBe(false);
    await user.click(dialog.getByRole('button', { name: 'Delete' }));

    expect(await screen.findByText('The source was deleted.')).toBeInTheDocument();
    expect(server.requests.filter(isDelete)).toHaveLength(1);
    // The list is read again once the source is gone.
    expect(server.requests.filter(isList).length).toBeGreaterThan(1);
  });
});
