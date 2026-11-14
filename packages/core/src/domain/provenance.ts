import { z } from 'zod';
import { entityMatchRuleSchema } from './schemas.ts';

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
