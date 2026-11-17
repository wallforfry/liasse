import type { ConsolidationRunView } from '@liasse/sdk';
import { screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { POLL_MILLISECONDS } from '../../lib/processing.ts';
import { errorBody, fakeServer, json, renderApp } from '../../test/render.test-helper.tsx';

const RUN: ConsolidationRunView = {
  id: 'job_01',
  trigger: 'manual',
  status: 'queued',
  attempts: 0,
  queued_at: '2026-11-17T09:00:00.000Z',
  due_at: '2026-11-17T09:00:00.000Z',
  last_error: null,
};

// The runs the server lists, one answer per read, the last one repeated.
const serve = (post: Response, ...listings: readonly (readonly ConsolidationRunView[])[]) => {
  const reads = { count: 0 };
  const server = fakeServer((request) => {
    if (request.path !== '/consolidation/runs') {
      return request.path === '/changes' ? json({ changes: [], truncated: false }) : undefined;
    }
    if (request.method === 'POST') return post;
    const runs = listings[Math.min(reads.count, listings.length - 1)] ?? [];
    reads.count += 1;
    return json({ runs });
  });
  renderApp('/changes', server.fetch);
  return server;
};

const ask = async (user = userEvent.setup()) => {
  await user.click(await screen.findByRole('button', { name: 'Run consolidation' }));
};

describe('a consolidation run asked for by hand', () => {
  it('is queued with the session cookie and no body', async () => {
    const server = serve(json({ queued: true }, 202), [], [RUN]);
    await ask();
    expect(await screen.findByText('A consolidation run was queued.')).toBeInTheDocument();
    const posts = server.requests.filter(({ method }) => method === 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0]?.credentials).toBe('same-origin');
    expect(posts[0]?.body).toBeUndefined();
  });

  it('is followed until it ends, then the changes are read again', async () => {
    // The page reads the runs again on a timer: the clock is moved, not waited for.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const server = serve(
        json({ queued: true }, 202),
        [],
        [{ ...RUN, status: 'running', attempts: 1 }],
        [{ ...RUN, status: 'succeeded', attempts: 1 }],
      );
      await ask(userEvent.setup({ advanceTimers: vi.advanceTimersByTime }));
      expect(await screen.findByText('Consolidation is running.')).toBeInTheDocument();
      await vi.advanceTimersByTimeAsync(POLL_MILLISECONDS);
      expect(
        await screen.findByText('The consolidation run finished: its proposals are listed.'),
      ).toBeInTheDocument();
      expect(server.requests.filter(({ path }) => path === '/changes').length).toBeGreaterThan(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports the error of a run that failed', async () => {
    const failed = {
      ...RUN,
      status: 'failed' as const,
      attempts: 3,
      last_error: 'Error: the text model refused the request',
    };
    serve(json({ queued: true }, 202), [], [failed]);
    await ask();
    expect(
      await screen.findByText(
        'The consolidation run failed: Error: the text model refused the request',
      ),
    ).toBeInTheDocument();
  });

  it('shows a run in progress when the page opens, and a retry with its error', async () => {
    serve(json({ queued: true }, 202), [
      { ...RUN, attempts: 1, last_error: 'Error: timeout', due_at: '2026-11-17T09:05:00.000Z' },
    ]);
    expect(
      await screen.findByText('An attempt failed, the run will try again: Error: timeout'),
    ).toBeInTheDocument();
  });

  it('says when the runs could not be read', async () => {
    const server = fakeServer((request) => {
      if (request.path === '/consolidation/runs') {
        return errorBody(500, 'internal', 'The runs could not be listed.');
      }
      return request.path === '/changes' ? json({ changes: [], truncated: false }) : undefined;
    });
    renderApp('/changes', server.fetch);
    expect(await screen.findByText('The consolidation runs could not be read')).toBeInTheDocument();
  });

  it('says when a run was already waiting', async () => {
    serve(json({ queued: false }, 202), [RUN]);
    await ask();
    expect(await screen.findByText('A consolidation run is already queued.')).toBeInTheDocument();
  });

  it('reports what the API refuses', async () => {
    serve(errorBody(501, 'not_implemented', 'Consolidation runs are not available.'), []);
    await ask();
    await waitFor(() => {
      expect(screen.getByText('Consolidation runs are not available.')).toBeInTheDocument();
    });
  });
});
