// `documents.provenance` is keyed by the bare name of the field it describes, for a core
// field and for a type field alike: the registry reserves the core names, so the two
// never collide and no namespace is needed.
//
// The value of an entity field in `core` or `fields` is the name as it was extracted. The
// entity it was resolved to is recorded here, under this key of the provenance of the field.
export const PROVENANCE_ENTITY_ID_KEY = 'entity_id';

// Where the id of the entity a field was resolved to is, inside `documents.provenance`.
export const entityIdProvenancePath = (fieldName: string): readonly [string, string] => [
  fieldName,
  PROVENANCE_ENTITY_ID_KEY,
];
