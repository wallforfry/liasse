import {
  settingsCheckRequestSchema,
  settingsCheckSchema,
  settingsModelsRequestSchema,
  settingsModelsSchema,
  settingsStateSchema,
  settingsUpdateSchema,
} from '@liasse/contract';
import {
  checkSettingsDraft,
  listSettingsModels,
  readSettingsState,
  saveSettings,
  type SettingsContext,
} from '@liasse/core/api';
import { Hono, type MiddlewareHandler } from 'hono';
import { failures, jsonResponse, operation, SESSION_SCHEME, valid } from '../describe.ts';
import type { AppEnv } from '../env.ts';
import { jsonBody } from '../guards.ts';

const TAG = 'Settings';
const CREDENTIALS = [SESSION_SCHEME];

export interface SettingsRouteDeps {
  readonly settings: SettingsContext;
  /**
   * The session of the web UI and nothing else: a leaked API key must not be able to send
   * the documents to a model of its choosing.
   */
  readonly signedIn: MiddlewareHandler<AppEnv>;
  /** The same, with the deadline of a check, which may load the local model. */
  readonly signedInToCheck: MiddlewareHandler<AppEnv>;
}

export const settingsRoutes = ({
  settings,
  signedIn,
  signedInToCheck,
}: SettingsRouteDeps): Hono<AppEnv> =>
  new Hono<AppEnv>()
    .get(
      '/settings',
      operation({
        summary: 'The settings, keys replaced by whether each is set',
        tag: TAG,
        credentials: CREDENTIALS,
        responses: { 200: jsonResponse('The settings and their version.', settingsStateSchema) },
      }),
      signedIn,
      async (context) => context.json(await readSettingsState(settings)),
    )
    .put(
      '/settings',
      operation({
        summary: 'Save the whole settings document, applied without a restart',
        tag: TAG,
        credentials: CREDENTIALS,
        responses: {
          200: jsonResponse('The settings as saved, in force.', settingsStateSchema),
          ...failures(400, 409, 413, 415),
        },
      }),
      signedIn,
      jsonBody,
      valid('json', settingsUpdateSchema),
      async (context) => context.json(await saveSettings(settings, context.req.valid('json'))),
    )
    .post(
      '/settings/check',
      operation({
        summary: 'Try settings with one short call per part, without saving them',
        tag: TAG,
        credentials: CREDENTIALS,
        responses: {
          200: jsonResponse('What each part answered.', settingsCheckSchema),
          ...failures(400, 413, 415),
        },
      }),
      signedInToCheck,
      jsonBody,
      valid('json', settingsCheckRequestSchema),
      async (context) =>
        context.json(await checkSettingsDraft(settings, context.req.valid('json'))),
    )
    .post(
      '/settings/models',
      operation({
        summary: 'List the models of the provider of one section, without saving anything',
        tag: TAG,
        credentials: CREDENTIALS,
        responses: {
          200: jsonResponse(
            'The ids the provider lists, or why it listed none.',
            settingsModelsSchema,
          ),
          ...failures(400, 413, 415),
        },
      }),
      signedIn,
      jsonBody,
      valid('json', settingsModelsRequestSchema),
      async (context) =>
        context.json(await listSettingsModels(settings, context.req.valid('json'))),
    );
