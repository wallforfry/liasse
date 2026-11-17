import { AUTO_APPLY_MODES, SCHEMA_LANGUAGES } from '@liasse/contract/domain';
import { SettingsCard } from './settings-card.tsx';
import { ChoiceField, TextField } from './settings-fields.tsx';
import { fieldSetter, issueAt, type SectionProps } from './settings-form.ts';

/** Nothing of the pipeline answers a check: the section has no check button. */
export const PipelineSection = ({ values, issues, onChange }: SectionProps<'pipeline'>) => {
  const set = fieldSetter(values, onChange);
  const error = (field: keyof typeof values) => issueAt(issues, `pipeline.${field}`);
  return (
    <SettingsCard
      id="pipeline"
      title="Pipeline"
      description="How documents are read, and how far consolidation may change the types alone."
    >
      <ChoiceField
        id="pipeline-auto-apply"
        label="Auto-apply"
        options={AUTO_APPLY_MODES}
        hint="none applies nothing alone; safe applies the changes known to be safe; all applies every change."
        value={values.auto_apply}
        onChange={set('auto_apply')}
        error={error('auto_apply')}
      />
      <TextField
        id="pipeline-confidence-threshold"
        label="Confidence threshold"
        kind="number"
        hint="From 0 to 1: a document extracted with less confidence waits for review."
        value={values.confidence_threshold}
        onChange={set('confidence_threshold')}
        error={error('confidence_threshold')}
      />
      <TextField
        id="pipeline-max-new-types"
        label="New types per day"
        kind="number"
        hint="Beyond, a document takes the closest type and waits for review."
        value={values.max_new_types_per_day}
        onChange={set('max_new_types_per_day')}
        error={error('max_new_types_per_day')}
      />
      <ChoiceField
        id="pipeline-schema-language"
        label="Schema language"
        options={SCHEMA_LANGUAGES}
        hint="The language of new type slugs and field names."
        value={values.schema_language}
        onChange={set('schema_language')}
        error={error('schema_language')}
      />
      <TextField
        id="pipeline-max-vision-pages"
        label="Max vision pages"
        kind="number"
        hint="The longest scanned PDF transcribed page by page."
        value={values.max_vision_pages}
        onChange={set('max_vision_pages')}
        error={error('max_vision_pages')}
      />
      <TextField
        id="pipeline-entity-attach"
        label="Entity attach similarity"
        kind="number"
        hint="Cosine, from 0 to 1, for resolving entities by similarity."
        value={values.entity_attach_similarity}
        onChange={set('entity_attach_similarity')}
        error={error('entity_attach_similarity')}
      />
      <TextField
        id="pipeline-entity-arbitration"
        label="Entity arbitration similarity"
        kind="number"
        hint="Cosine, from 0 to 1, at most the attach similarity."
        value={values.entity_arbitration_similarity}
        onChange={set('entity_arbitration_similarity')}
        error={error('entity_arbitration_similarity')}
      />
      <TextField
        id="pipeline-max-file-size"
        label="Max file size (bytes)"
        kind="number"
        value={values.max_file_size}
        onChange={set('max_file_size')}
        error={error('max_file_size')}
      />
    </SettingsCard>
  );
};
