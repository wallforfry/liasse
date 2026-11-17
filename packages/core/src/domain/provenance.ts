import { rejectionSchema } from '@liasse/contract';
import {
  CLASSIFICATION_OUTCOMES,
  entityMatchRuleSchema,
  TYPE_REFUSALS,
} from '@liasse/contract/domain';
import { z } from 'zod';

// `documents.provenance` is keyed by the bare name of the field it describes, for a core
// field and for a type field alike: the registry reserves the core names, so the two
// never collide and no namespace is needed. The entry of a list field is an array with
// one entry per item, in the order of the value.
//
// The value of an entity field in `core` or `fields` is the name as it was extracted. The
// entity it was resolved to is recorded here, under this key of the provenance of the
// field: `provenance.issuer.entity_id`, and `provenance.parties[1].entity_id` for the
// second item of a list field `parties`.
export const PROVENANCE_ENTITY_ID_KEY = 'entity_id';

// Where the id of the entity a field was resolved to is, inside `documents.provenance`.
// A list field has no single path: each entry of its array carries the key.
export const entityIdProvenancePath = (fieldName: string): readonly [string, string] => [
  fieldName,
  PROVENANCE_ENTITY_ID_KEY,
];

// The provenance entry of an entity-typed value, as entity resolution writes it.
export const entityProvenanceSchema = z.strictObject({
  [PROVENANCE_ENTITY_ID_KEY]: z.string().min(1),
  match: entityMatchRuleSchema,
  confidence: z.number().min(0).max(1),
});
export type EntityProvenance = Readonly<z.output<typeof entityProvenanceSchema>>;

const confidence = z.number().min(0).max(1);

// The provenance entry of a value the extraction call produced. An entity-typed value has
// the entry of `entityProvenanceSchema` instead: the specification gives it no quote.
export const extractedProvenanceSchema = z.strictObject({
  model: z.string().min(1),
  // Null for a document without a type, which has the common core only.
  schema_version: z.number().int().min(1).nullable(),
  confidence,
  page: z.number().int().min(1),
  quote: z.string().min(1),
});
export type ExtractedProvenance = Readonly<z.output<typeof extractedProvenanceSchema>>;

// The provenance entry of a value a person wrote through `update_document`.
export const manualProvenanceSchema = z.strictObject({ manual: z.literal(true) });
export type ManualProvenance = Readonly<z.output<typeof manualProvenanceSchema>>;

export const MANUAL_PROVENANCE: ManualProvenance = Object.freeze({ manual: true });

// A corrected entity name still designates an entity.
export const manualEntityProvenanceSchema = z.strictObject({
  ...entityProvenanceSchema.shape,
  manual: z.literal(true),
});
export type ManualEntityProvenance = Readonly<z.output<typeof manualEntityProvenanceSchema>>;

// The entry of `documents.manual_fields` that says the type itself was chosen by a
// person. Field names are snake_case, so it cannot be one.
export const MANUAL_TYPE_FIELD = '@type';

// The one key of `documents.provenance` that is not a field name: how the pipeline
// obtained what no field carries (the text, the type, the extraction as a whole).
export const PIPELINE_PROVENANCE_KEY = '@pipeline';

const textProvenanceSchema = z.object({
  method: z.string(),
  vision_model: z.string().optional(),
  attachments_ingested: z.number().int().min(0),
  // Parts displayed inside the message, and files of a format ingestion refuses.
  attachments_skipped: z.number().int().min(0),
});

const typeProvenanceSchema = z.union([
  manualProvenanceSchema,
  z.object({
    model: z.string(),
    confidence,
    outcome: z.enum(CLASSIFICATION_OUTCOMES),
    // Set with the outcome `untyped`: why the new type the model proposed was not created.
    refusal: z.enum(TYPE_REFUSALS).optional(),
  }),
]);
export type TypeProvenance = Readonly<z.output<typeof typeProvenanceSchema>>;

const extractionProvenanceSchema = z.object({
  model: z.string(),
  schema_version: z.number().int().min(1).nullable(),
  // True when the document was longer than the extraction budget: the model read its
  // beginning only.
  truncated: z.boolean(),
  // Values the model returned that were dropped: no verifiable quote, or not valid.
  rejected_values: z.number().int().min(0),
  // The same, by section, name and reason; absent from an extraction stored before it was
  // recorded. Never the value or its quote.
  rejections: z.array(rejectionSchema).optional(),
  // Identifiers the model gave for an entity that were not used: absent from the text,
  // empty or malformed.
  dropped_identifiers: z.number().int().min(0).optional(),
});

export const pipelineProvenanceSchema = z.object({
  text: textProvenanceSchema.optional(),
  type: typeProvenanceSchema.optional(),
  extraction: extractionProvenanceSchema.optional(),
});
export type PipelineProvenance = Readonly<z.output<typeof pipelineProvenanceSchema>>;

// A row written before a key existed, or around the pipeline, reads as an empty record.
export const readPipelineProvenance = (
  provenance: Readonly<Record<string, unknown>>,
): PipelineProvenance =>
  pipelineProvenanceSchema.safeParse(provenance[PIPELINE_PROVENANCE_KEY]).data ?? {};
