import {
  pipelineSettingsSchema,
  type SecretUpdate,
  type SettingsDraftInput,
  settingsDraftSchema,
  type SettingsView,
} from '@liasse/contract';
import type {
  AutoApplyMode,
  EmbeddingProvider,
  LlmProvider,
  SchemaLanguage,
  SecretState,
} from '@liasse/contract/domain';
import type { Issues } from './settings-validation.ts';

/** The key of a section as edited: what the save does with the stored one. */
export interface KeyField {
  readonly state: SecretState;
  readonly update: SecretUpdate;
}

/** The form, every input as typed: numbers stay text until the schema reads them. */
export interface SettingsValues {
  readonly llm: {
    readonly provider: LlmProvider;
    readonly base_url: string;
    readonly text_model: string;
    readonly vision_model: string;
    readonly timeout_ms: string;
    readonly api_key: KeyField;
  };
  readonly embedding: {
    readonly provider: EmbeddingProvider;
    readonly model: string;
    readonly base_url: string;
    readonly timeout_ms: string;
    readonly max_input_tokens: string;
    readonly api_key: KeyField;
  };
  readonly pipeline: {
    readonly max_file_size: string;
    readonly auto_apply: AutoApplyMode;
    readonly confidence_threshold: string;
    readonly max_new_types_per_day: string;
    readonly schema_language: SchemaLanguage;
    readonly max_vision_pages: string;
    readonly entity_attach_similarity: string;
    readonly entity_arbitration_similarity: string;
  };
  readonly hindsight: {
    readonly url: string;
    readonly bank: string;
    readonly api_key: KeyField;
  };
}

export type SettingsSection = keyof SettingsValues;

const KEEP: SecretUpdate = { action: 'keep' };

const keyField = (state: SecretState): KeyField => ({ state, update: KEEP });

const text = (value: string | undefined): string => value ?? '';
const numberText = (value: number | undefined): string =>
  value === undefined ? '' : String(value);

const draftShape = settingsDraftSchema.shape;

/** The settings of a database that never saved any: the defaults of the schema. */
const unsavedView = (): SettingsView => ({
  llm: {
    provider: draftShape.llm.shape.provider.parse(undefined),
    text_model: '',
    vision_model: '',
    timeout_ms: draftShape.llm.shape.timeout_ms.parse(undefined),
    api_key_state: 'unset',
  },
  embedding: { ...draftShape.embedding.parse(undefined), api_key_state: 'unset' },
  pipeline: pipelineSettingsSchema.parse({}),
  hindsight: { ...draftShape.hindsight.parse(undefined), api_key_state: 'unset' },
});

/** The form showing `view`, every key kept; the schema defaults when nothing was saved. */
export const valuesOf = (saved: SettingsView | null): SettingsValues => {
  const view = saved ?? unsavedView();
  const { pipeline } = view;
  return {
    llm: {
      provider: view.llm.provider,
      base_url: text(view.llm.base_url),
      text_model: view.llm.text_model,
      vision_model: view.llm.vision_model,
      timeout_ms: numberText(view.llm.timeout_ms),
      api_key: keyField(view.llm.api_key_state),
    },
    embedding: {
      provider: view.embedding.provider,
      model: text(view.embedding.model),
      base_url: text(view.embedding.base_url),
      timeout_ms: numberText(view.embedding.timeout_ms),
      max_input_tokens: numberText(view.embedding.max_input_tokens),
      api_key: keyField(view.embedding.api_key_state),
    },
    pipeline: {
      max_file_size: numberText(pipeline.max_file_size),
      auto_apply: pipeline.auto_apply,
      confidence_threshold: numberText(pipeline.confidence_threshold),
      max_new_types_per_day: numberText(pipeline.max_new_types_per_day),
      schema_language: pipeline.schema_language,
      max_vision_pages: numberText(pipeline.max_vision_pages),
      entity_attach_similarity: numberText(pipeline.entity_attach_similarity),
      entity_arbitration_similarity: numberText(pipeline.entity_arbitration_similarity),
    },
    hindsight: {
      url: text(view.hindsight.url),
      bank: view.hindsight.bank,
      api_key: keyField(view.hindsight.api_key_state),
    },
  };
};

const optionalText = (value: string): string | undefined =>
  value.trim() === '' ? undefined : value;
// An empty input is not a number: the schema refuses it rather than reading 0.
const number = (value: string): number => (value.trim() === '' ? Number.NaN : Number(value));
const optionalNumber = (value: string): number | undefined =>
  value.trim() === '' ? undefined : Number(value);

/** Whether the embedder runs in the process, with no endpoint, key or window of its own. */
export const isLocalEmbedder = (provider: EmbeddingProvider): boolean => provider === 'local';

const localEmbedderKey = ({ state }: KeyField): SecretUpdate =>
  state === 'unreadable' ? { action: 'clear' } : KEEP;

/** The document the form sends, before the schema reads it. */
export const draftOf = ({ llm, embedding, pipeline, hindsight }: SettingsValues) => {
  const local = isLocalEmbedder(embedding.provider);
  return {
    llm: {
      provider: llm.provider,
      base_url: optionalText(llm.base_url),
      text_model: llm.text_model,
      vision_model: llm.vision_model,
      timeout_ms: number(llm.timeout_ms),
      api_key: llm.api_key.update,
    },
    embedding: {
      provider: embedding.provider,
      model: optionalText(embedding.model),
      base_url: local ? undefined : optionalText(embedding.base_url),
      timeout_ms: number(embedding.timeout_ms),
      max_input_tokens: local ? undefined : optionalNumber(embedding.max_input_tokens),
      // Nothing reads the key of the local embedder: one that no longer opens is dropped,
      // since the server refuses to keep it.
      api_key: local ? localEmbedderKey(embedding.api_key) : embedding.api_key.update,
    },
    pipeline: {
      max_file_size: number(pipeline.max_file_size),
      auto_apply: pipeline.auto_apply,
      confidence_threshold: number(pipeline.confidence_threshold),
      max_new_types_per_day: number(pipeline.max_new_types_per_day),
      schema_language: pipeline.schema_language,
      max_vision_pages: number(pipeline.max_vision_pages),
      entity_attach_similarity: number(pipeline.entity_attach_similarity),
      entity_arbitration_similarity: number(pipeline.entity_arbitration_similarity),
    },
    hindsight: {
      url: optionalText(hindsight.url),
      bank: hindsight.bank,
      api_key: hindsight.api_key.update,
    },
  } satisfies SettingsDraftInput;
};

/** What the component of one section of the form takes. */
export interface SectionProps<Section extends SettingsSection> {
  readonly values: SettingsValues[Section];
  readonly issues: Issues;
  readonly onChange: (values: SettingsValues[Section]) => void;
}

/** The change handler of one field of a section. */
export const fieldSetter =
  <Values extends object>(values: Values, onChange: (values: Values) => void) =>
  <Key extends keyof Values>(key: Key) =>
  (value: Values[Key]): void => {
    onChange({ ...values, [key]: value });
  };
