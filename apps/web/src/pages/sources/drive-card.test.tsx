import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { errorBody, fakeServer, renderApp } from '../../test/render.test-helper.tsx';
import { CONSENT_URL, DRIVE_SOURCE, isAuthorize, sourcesServer } from './sources.test-helper.ts';

const card = async () => within(await screen.findByRole('region', { name: DRIVE_SOURCE.name }));

const showing = (source: unknown) => fakeServer(sourcesServer({ sources: [source] }));

describe('the card of a Drive source', () => {
  it('says which folder it reads and that it waits for Google, never a password', async () => {
    renderApp('/sources', showing(DRIVE_SOURCE).fetch);

    const source = await card();
    expect(source.getByText('Google Drive')).toBeInTheDocument();
    expect(
      source.getByText('Drive folder 1SyntheticFolder_id-42', { exact: false }),
    ).toBeInTheDocument();
    expect(source.getByText('Not connected to Google')).toBeInTheDocument();
    expect(source.getByRole('button', { name: 'Connect with Google' })).toBeEnabled();
    expect(source.getByRole('button', { name: 'Run now' })).toBeDisabled();
    expect(source.queryByText(/password/iu)).not.toBeInTheDocument();
  });

  it('sends the browser to the consent page of Google', async () => {
    const server = showing(DRIVE_SOURCE);
    const { navigateAway } = renderApp('/sources', server.fetch);

    await userEvent
      .setup()
      .click((await card()).getByRole('button', { name: 'Connect with Google' }));

    await waitFor(() => {
      expect(navigateAway).toHaveBeenCalledWith(CONSENT_URL);
    });
    expect(server.requests.filter(isAuthorize).map(({ path }) => path)).toEqual([
      `/sources/${DRIVE_SOURCE.id}/google/authorize`,
    ]);
  });

  it('points to the settings while no Google client is saved', async () => {
    const server = fakeServer(
      sourcesServer({
        sources: [DRIVE_SOURCE],
        authorize: () =>
          errorBody(409, 'google_client_missing', 'Save the client id and secret first.'),
      }),
    );
    const { navigateAway } = renderApp('/sources', server.fetch);
    const user = userEvent.setup();

    const source = await card();
    await user.click(source.getByRole('button', { name: 'Connect with Google' }));

    expect(await source.findByText('No Google client yet')).toBeInTheDocument();
    await user.click(source.getByRole('link', { name: 'Settings' }));
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(navigateAway).not.toHaveBeenCalled();
  });

  it('shows another refusal of the consent as it is', async () => {
    const server = fakeServer(
      sourcesServer({
        sources: [DRIVE_SOURCE],
        authorize: () =>
          errorBody(400, 'source_kind_mismatch', 'Only a Drive source connects to Google.'),
      }),
    );
    renderApp('/sources', server.fetch);

    const source = await card();
    await userEvent.setup().click(source.getByRole('button', { name: 'Connect with Google' }));

    expect(await source.findByText('Only a Drive source connects to Google.')).toBeInTheDocument();
    expect(source.queryByText('No Google client yet')).not.toBeInTheDocument();
  });

  it('offers to connect again once Google refused the authorization', async () => {
    const refused = {
      ...DRIVE_SOURCE,
      secret: 'set',
      needs_attention: true,
      last_run: {
        started_at: '2026-11-18T08:00:00.000Z',
        finished_at: '2026-11-18T08:01:00.000Z',
        ingested: 0,
        duplicates: 0,
        skipped: 0,
        skipped_items: [],
        error: { kind: 'credentials', message: 'invalid_grant' },
      },
    };
    renderApp('/sources', showing(refused).fetch);

    const source = await card();
    expect(
      source.getByText('Needs attention: Google refused the authorization'),
    ).toBeInTheDocument();
    expect(
      source.getByText('The run stopped: Google refused the authorization'),
    ).toBeInTheDocument();
    expect(source.getByRole('button', { name: 'Connect again' })).toBeEnabled();
    expect(source.queryByText(/password/iu)).not.toBeInTheDocument();
  });

  it('offers to connect again when the authorization no longer opens', async () => {
    renderApp('/sources', showing({ ...DRIVE_SOURCE, secret: 'unreadable' }).fetch);

    const source = await card();
    expect(source.getByText('The authorization is unreadable')).toBeInTheDocument();
    expect(source.getByRole('button', { name: 'Connect again' })).toBeEnabled();
    expect(source.queryByText(/password/iu)).not.toBeInTheDocument();
  });

  it('offers to connect again once a check finds the authorization refused', async () => {
    const check = {
      ok: false,
      error: { kind: 'credentials', message: 'Google refused the authorization (invalid_grant).' },
    };
    const server = fakeServer(
      sourcesServer({ sources: [{ ...DRIVE_SOURCE, secret: 'set' }], check }),
    );
    const { navigateAway } = renderApp('/sources', server.fetch);
    const user = userEvent.setup();

    const source = await card();
    expect(source.queryByRole('button', { name: /^Connect/u })).not.toBeInTheDocument();
    await user.click(source.getByRole('button', { name: 'Check' }));
    await user.click(await source.findByRole('button', { name: 'Connect again' }));

    await waitFor(() => {
      expect(navigateAway).toHaveBeenCalledWith(CONSENT_URL);
    });
  });

  it('offers no new consent when a check fails for another reason', async () => {
    const check = { ok: false, error: { kind: 'transient', message: 'Drive answered 503.' } };
    renderApp(
      '/sources',
      fakeServer(sourcesServer({ sources: [{ ...DRIVE_SOURCE, secret: 'set' }], check })).fetch,
    );
    const source = await card();
    await userEvent.setup().click(source.getByRole('button', { name: 'Check' }));

    expect(await source.findByText('Check failed: Drive answered 503.')).toBeInTheDocument();
    expect(source.queryByRole('button', { name: /^Connect/u })).not.toBeInTheDocument();
  });

  it('offers no consent to a connected source, and runs it', async () => {
    renderApp('/sources', showing({ ...DRIVE_SOURCE, secret: 'set' }).fetch);

    const source = await card();
    expect(source.queryByRole('button', { name: /^Connect/u })).not.toBeInTheDocument();
    expect(source.queryByText('Not connected to Google')).not.toBeInTheDocument();
    expect(source.getByRole('button', { name: 'Run now' })).toBeEnabled();
  });

  it('says that a deletion drops the authorization at Google', async () => {
    renderApp('/sources', showing(DRIVE_SOURCE).fetch);

    await userEvent.setup().click((await card()).getByRole('button', { name: 'Delete' }));

    const dialog = within(await screen.findByRole('alertdialog'));
    expect(dialog.getByText(/its authorization at Google is dropped/u)).toBeInTheDocument();
    expect(dialog.queryByText(/password/iu)).not.toBeInTheDocument();
  });
});
