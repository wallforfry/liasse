// Synthetic documents and what the text model says of them, for the tests that take a
// document through the pipeline the server binds. Every value the extraction gives is
// quoted from the lines of its document, so it is kept.

export interface SyntheticDocument {
  /** The lines of its PDF: enough characters for a text layer read without vision. */
  readonly lines: readonly string[];
  readonly extraction: Readonly<Record<string, unknown>>;
}

const SUBJECT = 'Home insurance contract';

const quoted = (value: unknown, quote: string) => ({ value, page: 1, quote, confidence: 0.9 });

const subjectQuoted = (quote: string) => [{ kind: 'contract', name: SUBJECT, page: 1, quote }];

export const LETTER: SyntheticDocument = {
  lines: [
    'Ref SYN-0041',
    'Synthetic Letter Office, 1 Example Street, 00000 Nowhere',
    'Your home insurance contract is noted in our records.',
    'The next review is due on 15/03/2027.',
  ],
  extraction: {
    title: 'Synthetic letter',
    core: {
      reference: quoted('SYN-0041', 'Ref SYN-0041'),
      key_dates: [
        quoted({ kind: 'due', date: '2027-03-15', label: 'Next review' }, 'due on 15/03/2027'),
      ],
    },
    fields: {},
    extra: {},
    subjects: subjectQuoted('Your home insurance contract is noted'),
    facts: [
      {
        text: 'The next review is due on 15/03/2027.',
        page: 1,
        quote: 'The next review is due on 15/03/2027.',
        confidence: 0.9,
      },
    ],
  },
};

const contract = (
  title: string,
  reference: string,
  [day, renewal]: readonly [string, string],
): SyntheticDocument => {
  const written = (iso: string): string => iso.split('-').toReversed().join('/');
  return {
    lines: [
      title,
      'Synthetic Insurance SA, 2 Example Avenue, 00000 Nowhere',
      `Contract ${reference} dated ${written(day)}`,
      `The contract renews on ${written(renewal)}.`,
      'It covers the home insurance contract of the holder.',
    ],
    extraction: {
      title,
      summary: `${title} of Synthetic Insurance SA.`,
      core: {
        issuer: quoted('Synthetic Insurance SA', 'Synthetic Insurance SA'),
        reference: quoted(reference, `Contract ${reference}`),
        document_date: quoted(day, `dated ${written(day)}`),
        key_dates: [
          quoted(
            { kind: 'renewal', date: renewal, label: 'Renewal of the contract' },
            `renews on ${written(renewal)}`,
          ),
        ],
      },
      fields: {},
      extra: {},
      subjects: subjectQuoted('the home insurance contract of the holder'),
    },
  };
};

export const OLD_CONTRACT = contract('Home insurance contract 2026', 'HAB-2026-001', [
  '2026-01-25',
  '2027-01-25',
]);

export const NEW_CONTRACT = contract('Replacement home insurance contract', 'MC-2026-777', [
  '2026-06-20',
  '2027-06-20',
]);

const DOCUMENTS = [LETTER, OLD_CONTRACT, NEW_CONTRACT] as const;

const CLASSIFICATION = {
  decision: 'new',
  confidence: 0.9,
  justification: 'No candidate describes this document. The registry is empty.',
  new_type: {
    slug: 'synthetic_document',
    description: 'A synthetic document',
    parent_slug: null,
    fields: { letter_number: { type: 'identifier' } },
  },
} as const;

const titleOf = ({ lines }: SyntheticDocument): string => lines[0] ?? '';

// The document under review comes before its candidates, which alone carry an id.
const links = (prompt: string) => {
  const reviewed = prompt.slice(0, prompt.indexOf('"candidates"'));
  const candidates = [...prompt.matchAll(/"id": "(doc_[0-9A-Z]+)"/g)].map(([, id]) => id);
  return {
    links: reviewed.includes(`"${titleOf(NEW_CONTRACT)}"`)
      ? candidates.map((candidate) => ({
          candidate,
          kind: 'supersedes',
          actor: 'document',
          confidence: 0.95,
          rationale: 'It replaces the previous home insurance contract.',
        }))
      : [],
  };
};

/**
 * What the text model answers, told apart as the pipeline tests do, by the system prompt;
 * an extraction is the one of the document whose first line the prompt holds.
 */
export const answerFor = (system: string, prompt: string): unknown => {
  if (system.startsWith('You file')) return CLASSIFICATION;
  if (system.startsWith('You find the links')) return links(prompt);
  const document = DOCUMENTS.find((candidate) => prompt.includes(titleOf(candidate)));
  return document?.extraction ?? { core: {}, fields: {}, extra: {} };
};
