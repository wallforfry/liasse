import {
  SETUP_BASE_PATH,
  setupCheckRequestSchema,
  setupRequestSchema,
  setupResultSchema,
  setupStatusSchema,
  settingsCheckSchema,
} from '@liasse/contract';
import { checkSetup, completeSetup, readSetupStatus, type SetupContext } from '@liasse/core/api';
import { Hono, type MiddlewareHandler } from 'hono';
import { every } from 'hono/combine';
import { failures, jsonResponse, operation, valid } from '../describe.ts';
import type { AppEnv } from '../env.ts';
import { jsonBody } from '../guards.ts';

const TAG = 'Setup';
const PUBLIC: readonly string[] = [];

export interface SetupRouteDeps {
  readonly setup: SetupContext;
  /** The deadline of a quick request. */
  readonly timed: MiddlewareHandler<AppEnv>;
  /** The deadline of a check, which may load the local model, and the count of attempts. */
  readonly attempt: MiddlewareHandler<AppEnv>;
}

/** The onboarding: public routes, guarded by the setup token while no account exists. */
export const setupRoutes = ({ setup, timed, attempt }: SetupRouteDeps): Hono<AppEnv> =>
  new Hono<AppEnv>()
    .get(
      SETUP_BASE_PATH,
      operation({
        summary: 'Whether the first account is still to be created',
        tag: TAG,
        credentials: PUBLIC,
        responses: { 200: jsonResponse('Whether setup is needed.', setupStatusSchema) },
      }),
      timed,
      async (context) => context.json(await readSetupStatus(setup)),
    )
    .post(
      `${SETUP_BASE_PATH}/check`,
      operation({
        summary: 'Try settings with the setup token, without saving them',
        tag: TAG,
        credentials: PUBLIC,
        responses: {
          200: jsonResponse('What each part answered.', settingsCheckSchema),
          ...failures(400, 403, 409, 413, 415, 429),
        },
      }),
      every(attempt, jsonBody),
      valid('json', setupCheckRequestSchema),
      async (context) => context.json(await checkSetup(setup, context.req.valid('json'))),
    )
    .post(
      SETUP_BASE_PATH,
      operation({
        summary: 'Create the first account and save the settings, with the setup token',
        tag: TAG,
        credentials: PUBLIC,
        responses: {
          201: jsonResponse(
            'The account was created; the settings are in force.',
            setupResultSchema,
          ),
          ...failures(400, 403, 409, 413, 415, 429),
        },
      }),
      every(attempt, jsonBody),
      valid('json', setupRequestSchema),
      async (context) => context.json(await completeSetup(setup, context.req.valid('json')), 201),
    );
