import { z } from 'zod';
import { settingsDraftSchema, settingsViewSchema } from './settings.ts';

const version = z.int().min(0);

/** The answer of `GET /settings` and of a save. */
export const settingsStateSchema = z.object({
  version: version.describe('0 while no settings were ever saved.'),
  updated_at: z.iso.datetime().nullable(),
  settings: settingsViewSchema.nullable().describe('Null while no settings were ever saved.'),
  embedder_locked: z
    .boolean()
    .describe('True once a live document exists: the embedder can no longer change.'),
});
export type SettingsState = z.output<typeof settingsStateSchema>;

/** The body of `PUT /settings`: the whole document, and the version it was read at. */
export const settingsUpdateSchema = z.strictObject({
  version: version.describe('The version the settings were read at; a stale one answers 409.'),
  settings: settingsDraftSchema,
});
export type SettingsUpdate = z.output<typeof settingsUpdateSchema>;
export type SettingsUpdateInput = z.input<typeof settingsUpdateSchema>;

/** The body of `POST /settings/check`: settings tried as they are, never saved. */
export const settingsCheckRequestSchema = z.strictObject({ settings: settingsDraftSchema });
export type SettingsCheckRequest = z.output<typeof settingsCheckRequestSchema>;
export type SettingsCheckRequestInput = z.input<typeof settingsCheckRequestSchema>;

export const settingsPartCheckSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok') }),
  z.object({ status: z.literal('skipped').describe('Nothing to try: the part is off.') }),
  z.object({
    status: z.literal('failed'),
    code: z.string(),
    message: z.string().describe('Written by Liasse; never the message of the provider.'),
  }),
]);
export type SettingsPartCheck = z.output<typeof settingsPartCheckSchema>;

export const settingsCheckSchema = z.object({
  text_model: settingsPartCheckSchema,
  vision_model: settingsPartCheckSchema,
  embedder: settingsPartCheckSchema,
  hindsight: settingsPartCheckSchema,
});
export type SettingsCheck = z.output<typeof settingsCheckSchema>;
