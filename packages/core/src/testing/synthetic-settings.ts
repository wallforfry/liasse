import { type Settings, type SettingsInput, settingsSchema } from '@liasse/contract';
import { type ResolvedSettings, resolveSettings } from '../settings/resolve.ts';

// The smallest settings the schema accepts, with models that call no provider of the cloud.
export const SYNTHETIC_SETTINGS = {
  llm: { provider: 'ollama', text_model: 'text-model', vision_model: 'vision-model' },
} as const satisfies SettingsInput;

export interface SettingsOverrides {
  readonly llm?: Partial<SettingsInput['llm']>;
  readonly embedding?: SettingsInput['embedding'];
  readonly pipeline?: SettingsInput['pipeline'];
  readonly hindsight?: SettingsInput['hindsight'];
}

/** The synthetic settings with these sections changed, parsed by the schema of the contract. */
export const syntheticSettings = ({ llm = {}, ...sections }: SettingsOverrides = {}): Settings =>
  settingsSchema.parse({ ...sections, llm: { ...SYNTHETIC_SETTINGS.llm, ...llm } });

/** `EMBEDDING_DIM` and `EMBEDDING_CACHE_DIR` as `SYNTHETIC_ENV` leaves them. */
export const SYNTHETIC_EMBEDDING_ENVIRONMENT = {
  dimension: 384,
  cacheDir: '/data/models',
} as const;

export const resolvedSyntheticSettings = (overrides: SettingsOverrides = {}): ResolvedSettings =>
  resolveSettings(syntheticSettings(overrides), SYNTHETIC_EMBEDDING_ENVIRONMENT);
