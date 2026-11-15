import { render, type RenderResult } from '@testing-library/react';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { AppProviders } from '../app.tsx';
import { ROUTES } from '../routes.tsx';

export const TEST_ORIGIN = 'http://liasse.test';
export const TEST_CSRF = 'synthetic-csrf-token';

export interface Request {
  readonly method: string;
  readonly path: string;
  readonly headers: Headers;
  readonly credentials: RequestCredentials | undefined;
}

export type Answer = (request: Request) => Response | undefined;

export const json = (body: unknown, status = 200): Response => Response.json(body, { status });

export const errorBody = (status: number, code: string, message: string): Response =>
  json({ error: { code, message, request_id: 'req_synthetic' } }, status);

/**
 * A server that answers each request with the first answer that knows it, and remembers
 * every request. The session is live unless an answer says otherwise.
 */
export const fakeServer = (...answers: readonly Answer[]) => {
  const requests: Request[] = [];
  const fetch: typeof globalThis.fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const request: Request = {
      method: init?.method ?? 'GET',
      path: url.pathname + url.search,
      headers: new Headers(init?.headers),
      credentials: init?.credentials,
    };
    requests.push(request);
    const answered = answers.map((answer) => answer(request)).find((value) => value !== undefined);
    if (answered !== undefined) return Promise.resolve(answered);
    if (url.pathname === '/ui/session') return Promise.resolve(json({ csrf_token: TEST_CSRF }));
    return Promise.resolve(errorBody(404, 'not_found', 'No such route.'));
  };
  return { fetch, requests };
};

/** The application at `path` under `/ui`, over the given `fetch`. */
export const renderApp = (path: string, fetch: typeof globalThis.fetch): RenderResult => {
  const router = createMemoryRouter(ROUTES, { initialEntries: [path] });
  return render(
    <AppProviders baseUrl={TEST_ORIGIN} fetch={fetch}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
};
