import { z } from 'zod';
import {
  MAX_ACCOUNT_NAME_LENGTH,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from './domain/limits.ts';
import { settingsStateSchema } from './settings-api.ts';
import { settingsDraftSchema } from './settings.ts';

/** Where the onboarding answers, beside the auth server, while no account exists. */
export const SETUP_BASE_PATH = '/api/setup';

/** The answer of `GET /api/setup`. */
export const setupStatusSchema = z.object({
  needs_setup: z.boolean().describe('True while no account exists.'),
});
export type SetupStatus = z.output<typeof setupStatusSchema>;

const setupToken = z
  .string()
  .min(1)
  .max(256)
  .describe('The setup token the server printed to its standard error at startup.');

/** The first account. The password is kept exactly as written: it may start with a space. */
export const setupAccountSchema = z.strictObject({
  name: z.string().trim().min(1).max(MAX_ACCOUNT_NAME_LENGTH),
  email: z.email('expected an email address').transform((email) => email.toLowerCase()),
  password: z
    .string()
    .min(MIN_PASSWORD_LENGTH, `expected at least ${String(MIN_PASSWORD_LENGTH)} characters`)
    .max(MAX_PASSWORD_LENGTH, `expected at most ${String(MAX_PASSWORD_LENGTH)} characters`),
});
export type SetupAccount = z.output<typeof setupAccountSchema>;

/** The body of `POST /api/setup/check`: settings tried as they are, never saved. */
export const setupCheckRequestSchema = z.strictObject({
  token: setupToken,
  settings: settingsDraftSchema,
});
export type SetupCheckRequest = z.output<typeof setupCheckRequestSchema>;
export type SetupCheckRequestInput = z.input<typeof setupCheckRequestSchema>;

/** The body of `POST /api/setup`: the first account and the settings, saved together. */
export const setupRequestSchema = z.strictObject({
  token: setupToken,
  account: setupAccountSchema,
  settings: settingsDraftSchema,
});
export type SetupRequest = z.output<typeof setupRequestSchema>;
export type SetupRequestInput = z.input<typeof setupRequestSchema>;

/** The answer of `POST /api/setup`: the settings in force. The UI then signs in. */
export const setupResultSchema = z.object({
  email: z.string().describe('The email of the account, to sign in with.'),
  settings: settingsStateSchema,
});
export type SetupResult = z.output<typeof setupResultSchema>;
