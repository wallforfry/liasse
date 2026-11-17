import { AUTH_BASE_PATH, SETUP_BASE_PATH } from '@liasse/contract';
import { render, type RenderResult } from '@testing-library/react';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { type Mock, vi } from 'vitest';
import type { NavigateAway } from '../api/redirect.ts';
import { AppProviders } from '../app.tsx';
import { ROUTES } from '../routes.tsx';

export const TEST_ORIGIN = 'http://liasse.test';

export interface Request {
  readonly method: string;
  readonly path: string;
  readonly headers: Headers;
  readonly credentials: RequestCredentials | undefined;
  readonly body: RequestInit['body'];
}

export type Answer = (request: Request) => Response | undefined;

export const json = (body: unknown, status = 200): Response => Response.json(body, { status });

export const errorBody = (status: number, code: string, message: string): Response =>
  json({ error: { code, message, request_id: 'req_synthetic' } }, status);

/** A refusal of the auth server, as better-auth writes it. */
export const authError = (status: number, code: string, message: string): Response =>
  json({ code, message }, status);

export const authPath = (path: string): string => `${AUTH_BASE_PATH}${path}`;

export const LIVE_SESSION = {
  session: { id: 'ses_synthetic', expiresAt: '2026-12-15T10:00:00.000Z' },
  user: { id: 'usr_synthetic', email: 'owner@example.test', name: 'Owner' },
};

/** The body a request was sent with, read as JSON. */
export const jsonBody = (request: Request | undefined): unknown =>
  typeof request?.body === 'string' ? JSON.parse(request.body) : undefined;

/**
 * A server that answers each request with the first answer that knows it, and remembers
 * every request. The session is live and an account exists unless an answer says otherwise.
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
      body: init?.body,
    };
    requests.push(request);
    const answered = answers.map((answer) => answer(request)).find((value) => value !== undefined);
    if (answered !== undefined) return Promise.resolve(answered);
    if (url.pathname === authPath('/get-session')) return Promise.resolve(json(LIVE_SESSION));
    if (url.pathname === SETUP_BASE_PATH) return Promise.resolve(json({ needs_setup: false }));
    return Promise.resolve(errorBody(404, 'not_found', 'No such route.'));
  };
  return { fetch, requests };
};

/** The application at `path` under `/ui`, over the given `fetch`. */
export const renderApp = (
  path: string,
  fetch: typeof globalThis.fetch,
): RenderResult & {
  readonly navigateAway: Mock<NavigateAway>;
  readonly router: ReturnType<typeof createMemoryRouter>;
} => {
  const router = createMemoryRouter(ROUTES, { initialEntries: [path] });
  const navigateAway = vi.fn<NavigateAway>();
  return {
    ...render(
      <AppProviders baseUrl={TEST_ORIGIN} fetch={fetch} navigateAway={navigateAway}>
        <RouterProvider router={router} />
      </AppProviders>,
    ),
    navigateAway,
    router,
  };
};
