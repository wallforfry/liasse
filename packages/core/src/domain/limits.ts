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

// A hint given with a file is free text from the caller; it is cut, not rejected.
export const MAX_HINT_LENGTH = 2000;

// The longest file name the common file systems accept.
export const MAX_FILENAME_LENGTH = 255;

// How many times the watched folder may queue a failed document again by itself. A
// person handing the file back through the API or MCP resets the count.
export const MAX_WATCH_REQUEUES = 1;
