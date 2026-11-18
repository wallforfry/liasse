import { googleConsentSchema } from '@liasse/contract';
import { completeGoogleConsent, type SourcesContext, startGoogleConsent } from '@liasse/core/api';
import { Hono, type MiddlewareHandler } from 'hono';
import { z } from 'zod';
import { failures, jsonResponse, operation, SESSION_SCHEME, valid } from '../describe.ts';
import type { AppEnv } from '../env.ts';
import { idParam } from '../query-params.ts';
import { UI_ROOT } from '../ui/web-routes.ts';

/** Where Google sends the browser back: the redirect URI to register in the Google client. */
export const GOOGLE_CALLBACK_PATH = '/sources/google/callback';

const TAG = 'Sources';
const CREDENTIALS = [SESSION_SCHEME];

// What Google appends to the redirect URI (RFC 6749, 4.1.2), all of it optional: a
// declined consent comes back with `error` and no code. Other parameters are ignored.
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
    .get(
      GOOGLE_CALLBACK_PATH,
      operation({
        summary: 'Where Google sends the browser back after a consent',
        tag: TAG,
        credentials: CREDENTIALS,
        responses: {
          302: {
            description:
              'To the Sources page of the web UI, with `google` set to how the consent ended ' +
              'and `source` to the source it was for, once known.',
          },
          ...failures(400),
        },
      }),
      signedIn,
      valid('query', callbackQuery),
      async (context) => {
        const { outcome, sourceId } = await completeGoogleConsent(
          sources,
          context.req.valid('query'),
          context.get('sessionId'),
        );
        const query = new URLSearchParams({
          google: outcome,
          ...(sourceId === undefined ? {} : { source: sourceId }),
        });
        return context.redirect(`${UI_ROOT}/sources?${query.toString()}`, 302);
      },
    );
