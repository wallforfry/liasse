// One synthetic letter and what the text model says of it, for the tests that take a
// document through the pipeline the server binds.

const REFERENCE = 'SYN-0041';

/**
 * The lines of its PDF: enough characters for a text layer the pipeline reads as it is,
 * without the vision model, and the reference the extraction quotes.
 */
export const LETTER_LINES: readonly string[] = [
  `Ref ${REFERENCE}`,
  'Synthetic Letter Office, 1 Example Street, 00000 Nowhere',
  'This synthetic letter confirms that your request was received.',
  'No action is needed on your side.',
];

export const LETTER_CLASSIFICATION = {
  decision: 'new',
  confidence: 0.9,
  justification: 'No candidate describes a synthetic letter. The registry is empty.',
  new_type: {
    slug: 'synthetic_letter',
    description: 'A synthetic letter',
    parent_slug: null,
    fields: { letter_number: { type: 'identifier' } },
  },
} as const;

// A core value whose quote is in the text: without one the document goes to review.
export const LETTER_EXTRACTION = {
  title: 'Synthetic letter',
  core: { reference: { value: REFERENCE, page: 1, quote: `Ref ${REFERENCE}`, confidence: 0.9 } },
  fields: {},
  extra: {},
} as const;
