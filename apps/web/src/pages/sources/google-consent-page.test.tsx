import { GOOGLE_CONSENT_OUTCOMES, type GoogleConsentOutcome } from '@liasse/contract/domain';
import { screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeServer, json, jsonBody, renderApp } from '../../test/render.test-helper.tsx';
import { DRIVE_SOURCE, isComplete, isRead, sourcesServer } from './sources.test-helper.ts';

const RETURN = '/sources/google?code=synthetic-code&state=synthetic-state&scope=drive';

const TITLES: Readonly<Record<GoogleConsentOutcome, string>> = {
  connected: 'Connected to Google',
  denied: 'The consent was declined',
  invalid: 'This consent cannot be completed',
  refused: 'Google refused the authorization',
  missing_scope: 'Read access to Drive was not given',
};

const answering = (outcome: GoogleConsentOutcome) =>
  fakeServer(
    sourcesServer({
      sources: [DRIVE_SOURCE],
      complete: () => json({ outcome, source_id: DRIVE_SOURCE.id }),
    }),
  );

describe('the return from the consent of Google', () => {
  it.each(GOOGLE_CONSENT_OUTCOMES)('says in words how a consent ended: %s', async (outcome) => {
    renderApp(RETURN, answering(outcome).fetch);

    expect(await screen.findByText(TITLES[outcome])).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to the sources' })).toBeInTheDocument();
  });

  it('posts the answer once under StrictMode, which runs every effect twice', async () => {
    const server = answering('connected');
    renderApp(RETURN, server.fetch, { strict: true });

    expect(await screen.findByText(TITLES.connected)).toBeInTheDocument();
    expect(server.requests.filter(isComplete)).toHaveLength(1);
    expect(jsonBody(server.requests.find(isComplete))).toEqual({
      code: 'synthetic-code',
      state: 'synthetic-state',
    });
  });

  it('posts a declined consent with its error', async () => {
    const server = answering('denied');
    renderApp('/sources/google?error=access_denied&state=synthetic-state', server.fetch);

    expect(await screen.findByText(TITLES.denied)).toBeInTheDocument();
    expect(jsonBody(server.requests.find(isComplete))).toEqual({
      error: 'access_denied',
      state: 'synthetic-state',
    });
  });

  it('takes the answer out of the address without a history entry', async () => {
    const { router } = renderApp(RETURN, answering('connected').fetch);

    await screen.findByText(TITLES.connected);
    await waitFor(() => {
      expect(router.state.location.search).toBe('');
    });
    expect(router.state.location.pathname).toBe('/sources/google');
    expect(router.state.historyAction).toBe('REPLACE');
    expect(screen.getByText(TITLES.connected)).toBeInTheDocument();
  });

  it('reads the source again once connected', async () => {
    const server = answering('connected');
    const { router } = renderApp(`/sources/${DRIVE_SOURCE.id}/edit`, server.fetch);
    await screen.findByDisplayValue('1SyntheticFolder_id-42');

    await router.navigate(RETURN);
    await screen.findByText(TITLES.connected);
    await userEvent.setup().click(screen.getByRole('link', { name: 'Back to the sources' }));
    await router.navigate(`/sources/${DRIVE_SOURCE.id}/edit`);

    await waitFor(() => {
      expect(server.requests.filter(isRead)).toHaveLength(2);
    });
  });

  it('sends nothing when the address holds no answer', async () => {
    const server = answering('connected');
    renderApp('/sources/google', server.fetch);

    expect(await screen.findByText('No consent to complete')).toBeInTheDocument();
    expect(server.requests.some(isComplete)).toBe(false);
  });
});
