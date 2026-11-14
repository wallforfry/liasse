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

export const DEFAULT_QUERY_LIMIT = 50;
export const MAX_QUERY_LIMIT = 200;
export const MAX_QUERY_CONDITIONS = 20;
export const MAX_QUERY_IN_VALUES = 100;
export const MAX_QUERY_GROUP_BY = 3;
export const MAX_QUERY_SELECT = 40;
export const MAX_QUERY_STRING_LENGTH = 200;
export const MAX_QUERY_LISTED_FIELDS = 40;
export const MAX_QUERY_SUGGESTED_ENTITIES = 5;
// Errors, and warnings, a query answers with before it counts the rest.
export const MAX_QUERY_REPORTED_PROBLEMS = 20;
export const MAX_QUERY_ECHOED_KEYS = 5;
export const MAX_QUERY_ECHOED_LENGTH = 60;
// Entity names are matched in memory, by the one normaliser of entity names: a query
// reads at most this many entities to do it, and refuses names beyond.
export const MAX_QUERY_ENTITIES = 10_000;
// What is taken of each entity: its canonical name and its first aliases, and the start
// of each name. An entity may hold dozens of aliases of any length.
export const MAX_QUERY_ENTITY_NAMES = 16;
export const MAX_QUERY_ENTITY_NAME_LENGTH = 80;
// Names of an entity an unknown name is measured against to suggest it.
export const MAX_QUERY_SUGGESTION_NAMES = 4;
// Unknown entity names that get suggestions, and entities compared with each of them.
export const MAX_QUERY_SUGGESTED_NAMES = 5;
export const MAX_QUERY_SUGGESTION_CANDIDATES = 200;
export const DEFAULT_QUERY_TIMEOUT_MILLISECONDS = 5000;
