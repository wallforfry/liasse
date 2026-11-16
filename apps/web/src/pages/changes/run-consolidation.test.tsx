import { screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { errorBody, fakeServer, json, renderApp } from '../../test/render.test-helper.tsx';

const askFor = async (answer: Response) => {
  const server = fakeServer((request) => {
    if (request.method === 'POST' && request.path === '/consolidation/runs') return answer;
    if (request.path === '/changes') return json({ changes: [], truncated: false });
    return undefined;
  });
  renderApp('/changes', server.fetch);
  await userEvent.setup().click(await screen.findByRole('button', { name: 'Run consolidation' }));
  return server;
};

describe('a consolidation run asked for by hand', () => {
  it('is queued with the session cookie and no body', async () => {
    const server = await askFor(json({ queued: true }, 202));
    expect(
      await screen.findByText('A consolidation run was queued. Its proposals will appear here.'),
    ).toBeInTheDocument();
    const posts = server.requests.filter(({ method }) => method === 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0]?.credentials).toBe('same-origin');
    expect(posts[0]?.body).toBeUndefined();
  });

  it('says when a run was already waiting', async () => {
    await askFor(json({ queued: false }, 202));
    expect(await screen.findByText('A consolidation run is already queued.')).toBeInTheDocument();
  });

  it('reports what the API refuses', async () => {
    await askFor(errorBody(501, 'not_implemented', 'Consolidation runs are not available.'));
    await waitFor(() => {
      expect(screen.getByText('Consolidation runs are not available.')).toBeInTheDocument();
    });
  });
});
