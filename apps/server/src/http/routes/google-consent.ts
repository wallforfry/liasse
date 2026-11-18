import {
  GOOGLE_CALLBACK_PATH,
  GOOGLE_CONSENT_UI_PATH,
  googleConsentAnswerSchema,
  googleConsentResultSchema,
  googleConsentSchema,
} from '@liasse/contract';
import { completeGoogleConsent, type SourcesContext, startGoogleConsent } from '@liasse/core/api';
import { Hono, type MiddlewareHandler } from 'hono';
import { z } from 'zod';
import { failures, jsonResponse, operation, SESSION_SCHEME, valid } from '../describe.ts';
import type { AppEnv } from '../env.ts';
import { jsonBody } from '../guards.ts';
import { idParam } from '../query-params.ts';
import { UI_ROOT } from '../ui/web-routes.ts';

/** The page of the web UI that completes a consent with the session. */
const GOOGLE_CONSENT_PAGE = `${UI_ROOT}${GOOGLE_CONSENT_UI_PATH}`;

const TAG = 'Sources';
const CREDENTIALS = [SESSION_SCHEME];

// Google appends other parameters (`scope`, `authuser`, `prompt`), which nothing reads.
const callbackQuery = z.object({
  code: z.string().max(4096).optional(),
  state: z.string().max(4096).optional(),
  error: z.string().max(256).optional(),
});

export interface GoogleConsentRouteDeps {
  readonly sources: SourcesContext;
  /** The session of the web UI only, as every route of the sources. */
  readonly signedIn: MiddlewareHandler<AppEnv>;
}

export const googleConsentRoutes = ({ sources, signedIn }: GoogleConsentRouteDeps): Hono<AppEnv> =>
  new Hono<AppEnv>()
    .post(
      '/sources/:id/google/authorize',
      operation({
        summary: 'The consent page of Google for a Drive source, bound to this session',
        tag: TAG,
        credentials: CREDENTIALS,
        responses: {
          200: jsonResponse('Where to send the browser.', googleConsentSchema),
          ...failures(400, 404, 409),
        },
      }),
      signedIn,
      valid('param', idParam),
      async (context) =>
        context.json(
          await startGoogleConsent(
            sources,
            context.req.valid('param').id,
            context.get('sessionId'),
          ),
        ),
    )
    // The session cookie is `SameSite=Strict`: a browser withholds it from the navigation
    // Google starts, so this route takes no credential and only hands the answer to a page of
    // the web UI, whose own request completes the consent with the session.
    .get(
      GOOGLE_CALLBACK_PATH,
      operation({
        summary: 'Where Google sends the browser back after a consent',
        tag: TAG,
        credentials: [],
        responses: {
          302: {
            description:
              'To the page of the web UI that completes the consent, with the answer of Google.',
          },
          ...failures(400),
        },
      }),
      valid('query', callbackQuery),
      (context) => {
        const { code, state, error } = context.req.valid('query');
        const query = new URLSearchParams({
          ...(code === undefined ? {} : { code }),
          ...(state === undefined ? {} : { state }),
          ...(error === undefined ? {} : { error }),
        });
        return context.redirect(`${GOOGLE_CONSENT_PAGE}?${query.toString()}`, 302);
      },
    )
    .post(
      '/sources/google/complete',
      operation({
        summary: 'Complete a consent of Google started by this session',
        tag: TAG,
        credentials: CREDENTIALS,
        responses: {
          200: jsonResponse('How the consent ended.', googleConsentResultSchema),
          ...failures(400, 413, 415),
        },
      }),
      signedIn,
      jsonBody,
      valid('json', googleConsentAnswerSchema),
      async (context) =>
        context.json(
          await completeGoogleConsent(sources, context.req.valid('json'), context.get('sessionId')),
        ),
    );
