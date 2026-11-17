import { z } from 'zod';
import { MAX_LISTED_MODELS, MAX_MODEL_ID_LENGTH } from './domain/limits.ts';
import { embeddingProviderSchema, httpBaseUrlSchema, llmProviderSchema } from './domain/schemas.ts';
import {
  keyUpdateSchema,
  requiresBaseUrl,
  settingsDraftSchema,
  settingsViewSchema,
} from './settings.ts';

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

const failedCallSchema = z.object({
  status: z.literal('failed'),
  code: z.string(),
  message: z.string().describe('Written by Liasse; never the message of the provider.'),
});

export const settingsPartCheckSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok') }),
  z.object({ status: z.literal('skipped').describe('Nothing to try: the part is off.') }),
  failedCallSchema,
]);
export type SettingsPartCheck = z.output<typeof settingsPartCheckSchema>;

export const settingsCheckSchema = z.object({
  text_model: settingsPartCheckSchema,
  vision_model: settingsPartCheckSchema,
  embedder: settingsPartCheckSchema,
  hindsight: settingsPartCheckSchema,
});
export type SettingsCheck = z.output<typeof settingsCheckSchema>;

const endpointFields = {
  base_url: httpBaseUrlSchema.optional(),
  api_key: keyUpdateSchema.describe('A kept key is the stored key of the section.'),
};

/**
 * The body of `POST /settings/models`: the endpoint of one section as the form holds it,
 * unsaved. The local embedder lists nothing: it ships one model.
 */
export const settingsModelsRequestSchema = z
  .discriminatedUnion('section', [
    z.strictObject({
      section: z.literal('llm'),
      provider: llmProviderSchema,
      ...endpointFields,
    }),
    z.strictObject({
      section: z.literal('embedding'),
      provider: embeddingProviderSchema.exclude(['local']),
      ...endpointFields,
    }),
  ])
  .superRefine(({ provider, base_url: baseUrl }, ctx) => {
    if (baseUrl === undefined && requiresBaseUrl(provider)) {
      ctx.addIssue({
        code: 'custom',
        path: ['base_url'],
        message: `required when provider is ${provider}`,
      });
    }
  });
export type SettingsModelsRequest = z.output<typeof settingsModelsRequestSchema>;
export type SettingsModelsRequestInput = z.input<typeof settingsModelsRequestSchema>;

export const settingsModelsSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ok'),
    models: z
      .array(z.string().min(1).max(MAX_MODEL_ID_LENGTH))
      .max(MAX_LISTED_MODELS)
      .describe(
        'The ids the provider lists, sorted. Filtered to the purpose of the section only ' +
          'where the provider states what each model does (Gemini, and Mistral for language ' +
          'models); any other id may still be typed.',
      ),
  }),
  failedCallSchema,
]);
export type SettingsModels = z.output<typeof settingsModelsSchema>;
