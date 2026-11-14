import {
  KEY_DATE_KINDS,
  NOTICE_PERIOD_UNITS,
  type SchemaLanguage,
  SUBJECT_KINDS,
} from '../../domain/enums.ts';
import { MAX_FACTS_PER_DOCUMENT } from '../../domain/limits.ts';
import { wrapUntrusted } from '../../prompt/untrusted.ts';
import type { TypeFields } from '../../registry/fields.ts';
import type { FieldDefinition } from '../../registry/primitives.ts';
import { MAX_QUOTE_LENGTH } from '../extract/extraction-schema.ts';
import { MIN_FACT_QUOTE_LENGTH } from '../extract/support.ts';
import type { PageText } from '../token-budget.ts';
import { SCHEMA_LANGUAGE_NAMES, UNTRUSTED_RULE } from './classification.ts';

export const QUOTE_RULE = `Every value comes with the number of the page it was read on, a quote and your confidence between 0 and 1. The quote is copied from that page character for character, at most ${String(MAX_QUOTE_LENGTH)} characters, and contains the value as the document writes it. A value you cannot quote is left out: never guess, never compute, never complete.`;

export const extractionSystemPrompt = (language: SchemaLanguage): string =>
  [
    'You extract structured data from one document.',
    UNTRUSTED_RULE,
    QUOTE_RULE,
    'Dates are written YYYY-MM-DD, amounts as a number with an ISO 4217 currency code, periods as a start and an end date.',
    '"core" holds the fields every document has and "fields" those of its type; fill only what the document states.',
    `"extra" holds other useful information the fields do not cover, under snake_case keys in ${SCHEMA_LANGUAGE_NAMES[language]}, as text, numbers, booleans, dates or lists of them.`,
    '"title" names the document in a few words and "summary" says what it is in two sentences, both in the language of the document.',
    '"entities" lists each organization or person given as a value or named in a fact, once: its name as written, its kind (org or person), the identifiers printed next to it (company id, VAT number, customer number, IBAN, card number) and a few words of context.',
    `"core.key_dates" lists the dates that matter, each with a kind (${KEY_DATE_KINDS.join(', ')}) and a short label.`,
    `"facts" holds 1 to ${String(MAX_FACTS_PER_DOCUMENT)} short, self-contained statements of what the document establishes, each with the dates between which it holds when the document gives them, and the names of the entities and subjects it is about. The quote of a fact, at least ${String(MIN_FACT_QUOTE_LENGTH)} characters, states every name, date and number the fact gives, and the fact uses the words of its quote. No opinion, nothing the document does not say.`,
    `"subjects" lists the things the recipient owns or holds that the document is about (${SUBJECT_KINDS.join(', ')}), never the organizations or people involved. Each has a page and a quote that contains its name as the document writes it, and an identifier only when the document writes one.`,
    `"notice_period" is the notice period a contract states, as a whole amount of ${NOTICE_PERIOD_UNITS.join(', ')} with its page, a quote that writes the amount and the unit, and your confidence; leave it out when the document states none.`,
  ].join('\n');

const describeField = (definition: FieldDefinition): string => {
  if (definition.type === 'list') return `list of ${describeField(definition.items)}`;
  if (definition.type === 'enum') return `one of ${definition.values.join(', ')}`;
  return definition.type === 'identifier' && definition.format !== undefined
    ? `identifier (${definition.format})`
    : definition.type;
};

export interface ExtractionPromptType {
  readonly slug: string;
  readonly description: string;
  readonly fields: TypeFields;
}

export interface ExtractionPromptInput {
  /** Undefined for a document without a type: only the common core is extracted. */
  readonly type: ExtractionPromptType | undefined;
  readonly pages: readonly PageText[];
  readonly truncated: boolean;
}

// The slug, the description, the field names, the enum values and the identifier
// formats of a type were written by a model that had read other documents: they are
// delimited like a document.
const typeSection = ({ slug, description, fields }: ExtractionPromptType): string =>
  [
    'The type of the document, its description and its fields, as the registry holds them:',
    wrapUntrusted(
      [
        `Type: ${slug}`,
        description,
        ...Object.entries(fields).map(
          ([name, definition]) => `- ${name}: ${describeField(definition)}`,
        ),
      ].join('\n'),
    ),
  ].join('\n');

export const pageMarker = (page: number): string => `[page ${String(page)}]`;

// A marker written inside a page can pass for the next one. The page a value is said
// to be on is then wrong, and the quote is looked for on the other pages too.
const documentText = (pages: readonly PageText[]): string =>
  pages.map(({ page, text }) => `${pageMarker(page)}\n${text}`).join('\n\n');

export const extractionPrompt = ({ type, pages, truncated }: ExtractionPromptInput): string =>
  [
    type === undefined
      ? 'The document has no type: leave "fields" empty and fill "core" and "extra".'
      : typeSection(type),
    `The document, page by page${truncated ? ' (it is longer: only its beginning is given)' : ''}:`,
    wrapUntrusted(documentText(pages)),
  ].join('\n\n');
