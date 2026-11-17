import type { TypeSuggestion } from '@liasse/contract';
import { MAX_FIELDS_PER_TYPE, MAX_TYPE_DESCRIPTION_LENGTH } from '@liasse/contract/domain';
import {
  CORE_FIELD_NAMES,
  type FieldDefinition,
  fieldDefinitionSchema,
} from '@liasse/contract/registry';
import { closestTypes } from '../registry/read-types.ts';
import { type NewTypeProposal, newTypeSchema } from './classify/classification-schema.ts';
import type { PipelineDeps, PipelineSettings } from './deps.ts';
import { typeSuggestionPrompt, typeSuggestionSystemPrompt } from './prompts/type-suggestion.ts';

export interface SuggestTypeDeps extends Pick<PipelineDeps, 'db' | 'embedder' | 'textModel'> {
  readonly settings: Pick<PipelineSettings, 'schemaLanguage'>;
}

// A definition the registry would refuse, or a core field, is left out rather than
// refusing the whole draft: the person reviews it before anything is created.
const keptFields = (fields: NewTypeProposal['fields']): Readonly<Record<string, FieldDefinition>> =>
  Object.fromEntries(
    Object.entries(fields)
      .filter(([name]) => !CORE_FIELD_NAMES.includes(name))
      .flatMap(([name, raw]) => {
        const definition = fieldDefinitionSchema.safeParse(raw);
        return definition.success ? [[name, definition.data] as const] : [];
      })
      .slice(0, MAX_FIELDS_PER_TYPE),
  );

/**
 * Drafts a type from what a person wrote about it, with the rules the pipeline follows
 * when it proposes one. Nothing is stored: the draft is judged when it is sent to create
 * the type. The parent is kept only when it is a listed type without a parent itself.
 */
export const suggestType = async (
  { db, embedder, textModel, settings }: SuggestTypeDeps,
  request: string,
): Promise<TypeSuggestion> => {
  const [embedding] = await embedder.embed([request], 'query');
  if (embedding === undefined) throw new Error('The embedder returned no embedding');
  const closest = await closestTypes(embedding, { db });
  const { object } = await textModel.generateObject({
    schema: newTypeSchema,
    system: typeSuggestionSystemPrompt(settings.schemaLanguage),
    prompt: typeSuggestionPrompt(
      request,
      closest.map(({ type, exampleTitle }) => ({
        slug: type.slug,
        description: type.description,
        exampleTitle,
      })),
    ),
  });
  const roots = new Set(
    closest.filter(({ type }) => type.parentSlug === null).map(({ type }) => type.slug),
  );
  const parent = object.parent_slug ?? null;
  return {
    slug: object.slug.trim(),
    description: object.description.trim().slice(0, MAX_TYPE_DESCRIPTION_LENGTH),
    parent_slug: parent !== null && roots.has(parent) ? parent : null,
    fields: keptFields(object.fields),
  };
};
