// pgvector cannot build an HNSW index over a `vector` column wider than 2000 dimensions.
export const MAX_EMBEDDING_DIM = 2000;

export const MAX_FIELDS_PER_TYPE = 30;
export const MAX_SLUG_LENGTH = 64;
export const MAX_FIELD_NAME_LENGTH = 64;
export const MAX_ENUM_VALUES = 50;
export const MAX_IDENTIFIER_FORMAT_LENGTH = 32;
export const MAX_TYPE_DESCRIPTION_LENGTH = 500;

// A page without a text layer costs one vision call, so a scanned PDF longer than this is refused.
export const DEFAULT_MAX_VISION_PAGES = 100;
