import { screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  errorBody,
  fakeServer,
  json,
  jsonBody,
  renderApp,
} from '../../test/render.test-helper.tsx';

const serve = (answer: Response) => {
  const server = fakeServer((request) => {
    if (request.path === '/documents/reclassify') return answer;
    if (request.path.startsWith('/types')) return json({ types: [] });
    if (request.path.startsWith('/documents')) {
      return json({ documents: [], total: 0, has_more: false });
    }
    return undefined;
  });
  return server;
};

const reclassify = async () => {
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Analyse untyped documents again' }));
  await user.click(await screen.findByRole('button', { name: 'Analyse again' }));
};

describe('the reclassification of the untyped documents of the review queue', () => {
  it('asks for the untyped documents once confirmed, and says what was queued', async () => {
    const server = serve(json({ queued: 3, skipped: 1, remaining: 2 }, 202));
    renderApp('/review', server.fetch);
    await reclassify();
    expect(
      await screen.findByText(
        '3 untyped documents queued to be analysed again. 1 document already being processed. ' +
          '2 documents left: ask again.',
      ),
    ).toBeInTheDocument();
    const posts = server.requests.filter(({ method }) => method === 'POST');
    expect(posts.map(jsonBody)).toEqual([{ reason: 'type_untyped' }]);
  });

  it('shows the error of a refused request', async () => {
    renderApp(
      '/review',
      serve(errorBody(400, 'invalid_request', 'The request is not valid.')).fetch,
    );
    await reclassify();
    expect(await screen.findByText('The request is not valid.')).toBeInTheDocument();
  });

  it('is not offered on the list of every document', async () => {
    renderApp('/documents', serve(json({})).fetch);
    await screen.findByText('No document matches.');
    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: 'Analyse untyped documents again' }),
      ).not.toBeInTheDocument();
    });
  });
});
