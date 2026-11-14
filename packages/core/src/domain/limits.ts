import type { NoticePeriodUnit } from './enums.ts';

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

// Entity resolution, as the specification sets it: a mention whose embedding is closer
// than the first threshold is attached, one at or above the second is arbitrated by the
// text model among this many candidates, and anything below is a new entity.
export const ENTITY_ATTACH_SIMILARITY = 0.92;
export const ENTITY_ARBITRATION_SIMILARITY = 0.8;
export const ENTITY_ARBITRATION_CANDIDATES = 3;

export const MAX_ENTITY_NAME_LENGTH = 200;
export const MAX_ENTITY_CONTEXT_LENGTH = 500;
export const MAX_IDENTIFIERS_PER_MENTION = 20;
export const MAX_IDENTIFIER_VALUE_LENGTH = 64;

// A customer number is only unique for the entity that issued it. A short one is too
// likely to be issued twice to say on its own which entity a mention designates.
export const MIN_ATTACHING_CUSTOMER_NUMBER_LENGTH = 6;

// Under these lengths a value is a fragment, not an identifier: it would match, as a
// prefix or by chance, entities it says nothing about.
export const MIN_COMPANY_ID_LENGTH = 5;
export const MIN_VAT_NUMBER_LENGTH = 4;
// The shortest company id an establishment id may extend: a French SIREN, of which a
// SIRET is the longer form.
export const MIN_EXTENDABLE_COMPANY_ID_LENGTH = 9;

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

// Below this, an embedding model has no room for a chunk worth embedding next to its header.
export const MIN_EMBEDDING_INPUT_TOKENS = 64;

// The knowledge of one document, as the specification bounds it (1 to 5 facts) and as the
// extraction call may return it at most.
export const MAX_FACTS_PER_DOCUMENT = 5;
export const MAX_FACT_LENGTH = 500;
export const MAX_KEY_DATES_PER_DOCUMENT = 50;
export const MAX_KEY_DATE_LABEL_LENGTH = 200;
export const MAX_SUBJECTS_PER_DOCUMENT = 10;
export const MAX_SUBJECT_NAME_LENGTH = 200;
export const MAX_KNOWLEDGE_QUOTE_LENGTH = 300;
// A notice period longer than five years is a misreading, not a clause.
export const MAX_NOTICE_PERIOD: Readonly<Record<NoticePeriodUnit, number>> = {
  days: 1826,
  weeks: 260,
  months: 60,
};

// Under these lengths a value is a fragment, not an identifier of a subject. A contract
// number follows the rule of the customer numbers of entities.
export const MIN_LICENSE_PLATE_LENGTH = 4;
export const MIN_ATTACHING_CONTRACT_NUMBER_LENGTH = MIN_ATTACHING_CUSTOMER_NUMBER_LENGTH;

// Link detection, as the specification sets it: candidates dated within this many months
// of the document. Their number is bounded so that the one call stays small.
export const LINK_WINDOW_MONTHS = 12;
export const MAX_LINK_CANDIDATES = 12;
// The candidates ranked before the places are given out, and the places one type takes
// while documents of other types are there.
export const LINK_CANDIDATE_POOL = 100;
export const MAX_LINK_CANDIDATES_PER_TYPE = 6;
export const MAX_LINK_RATIONALE_LENGTH = 300;
// A link changes the state of a document, which hides its deadlines: one the text model is
// not sure of is not kept.
export const MIN_LINK_CONFIDENCE = 0.7;

export const DEFAULT_UPCOMING_LIMIT = 100;
export const MAX_UPCOMING_LIMIT = 500;
export const DEFAULT_TIMELINE_LIMIT = 100;
export const MAX_TIMELINE_LIMIT = 500;
export const DEFAULT_RECALL_LIMIT = 10;
export const MAX_RECALL_LIMIT = 50;
// Facts each ranking contributes to the fusion, and facts reached through the entities and
// the subjects of the direct hits.
export const RECALL_CANDIDATES_PER_RANKER = 50;
export const MAX_RECALL_RELATED = 10;
export const MAX_SUBJECT_DOCUMENTS = 50;
export const MAX_SUBJECT_NEXT_DATES = 5;
export const MAX_SUBJECT_SUGGESTIONS = 5;
