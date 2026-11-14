import { z } from 'zod';
import { SCORED_SECTIONS, TYPE_VERDICTS } from '../score/index.ts';

// The part of a run report a comparison reads. A report comes from a file, so it is
// parsed; anything else it holds is left alone.
const tallySchema = z.object({ precision: z.number().nullable(), recall: z.number().nullable() });

const comparedReportSchema = z.object({
  label: z.string(),
  models: z.object({
    text_model: z.string(),
    vision_model: z.string(),
    embedding_model: z.string(),
  }),
  documents: z.object({
    totals: z.object({
      documents: z.number(),
      invalid: z.number(),
      types: z.record(z.string(), z.number()),
      sections: z.record(z.string(), tallySchema),
      core_fields: z.record(z.string(), tallySchema),
      type_fields: z.record(z.string(), tallySchema),
      privacy: tallySchema,
      duplicates: tallySchema,
      masking: z.object({ identifiers: z.number(), leaked: z.number() }),
      transcription: z.object({ pages: z.number(), mean_f1: z.number().nullable() }),
    }),
  }),
  questions: z.object({
    passed: z.number(),
    total: z.number(),
    results: z.array(z.object({ id: z.string(), pass: z.boolean(), reasons: z.array(z.string()) })),
  }),
});

export type ComparedReport = z.output<typeof comparedReportSchema>;

export const parseReport = (value: unknown): ComparedReport => comparedReportSchema.parse(value);

type Tally = z.output<typeof tallySchema>;

const share = (value: number | null): string => (value === null ? '-' : value.toFixed(2));
const tallyCell = (tally: Tally | undefined): string =>
  tally === undefined ? '-' : `${share(tally.precision)} / ${share(tally.recall)}`;

const row = (cells: readonly string[]): string =>
  `| ${cells.map((cell) => cell.replaceAll('|', '\\|')).join(' | ')} |`;

// A line of a table: its name, and what it shows for one report.
type Row = readonly [string, (report: ComparedReport) => string];
type Totals = ComparedReport['documents']['totals'];

const ofTotals = (name: string, cell: (totals: Totals) => string): Row => [
  name,
  ({ documents }) => cell(documents.totals),
];

const table = (
  heading: string,
  reports: readonly ComparedReport[],
  rows: readonly Row[],
): readonly string[] => [
  row([heading, ...reports.map(({ label }) => label)]),
  row(['---', ...reports.map(() => '---')]),
  ...rows.map(([name, cell]) => row([name, ...reports.map(cell)])),
];

const namesIn = (
  reports: readonly ComparedReport[],
  part: (totals: Totals) => Readonly<Record<string, unknown>>,
): readonly string[] =>
  [...new Set(reports.flatMap(({ documents }) => Object.keys(part(documents.totals))))].sort();

const totalRows = (reports: readonly ComparedReport[]): readonly Row[] => [
  ['Text model', ({ models }) => models.text_model],
  ['Vision model', ({ models }) => models.vision_model],
  ['Embedding model', ({ models }) => models.embedding_model],
  ['Questions passed', ({ questions }) => `${String(questions.passed)}/${String(questions.total)}`],
  ofTotals(
    'Documents scored (invalid)',
    ({ documents, invalid }) => `${String(documents)} (${String(invalid)})`,
  ),
  ...TYPE_VERDICTS.map((verdict) =>
    ofTotals(`Type ${verdict}`, ({ types }) => String(types[verdict] ?? 0)),
  ),
  ...SCORED_SECTIONS.map((section) =>
    ofTotals(`${section} P / R`, ({ sections }) => tallyCell(sections[section])),
  ),
  ofTotals('privacy P / R', ({ privacy }) => tallyCell(privacy)),
  ofTotals('duplicates P / R', ({ duplicates }) => tallyCell(duplicates)),
  ofTotals(
    'Masking leaks',
    ({ masking }) => `${String(masking.leaked)}/${String(masking.identifiers)}`,
  ),
  ofTotals('Transcription mean F1', ({ transcription }) => share(transcription.mean_f1)),
  ...namesIn(reports, ({ core_fields }) => core_fields).map((name) =>
    ofTotals(`core ${name} P / R`, ({ core_fields }) => tallyCell(core_fields[name])),
  ),
  ...namesIn(reports, ({ type_fields }) => type_fields).map((name) =>
    ofTotals(`field ${name} P / R`, ({ type_fields }) => tallyCell(type_fields[name])),
  ),
];

const questionCell =
  (id: string) =>
  ({ questions }: ComparedReport): string => {
    const result = questions.results.find((candidate) => candidate.id === id);
    if (result === undefined) return '-';
    return result.pass ? 'pass' : `fail: ${result.reasons.join('; ')}`;
  };

/**
 * Runs side by side, one column each, as Markdown: totals, per-section and per-field
 * precision and recall, then each question with the reasons it failed.
 */
export const compareReports = (reports: readonly ComparedReport[]): string => {
  const questionIds = [
    ...new Set(reports.flatMap(({ questions }) => questions.results.map(({ id }) => id))),
  ];
  return [
    ...table('Totals', reports, totalRows(reports)),
    '',
    ...table(
      'Question',
      reports,
      questionIds.map((id): Row => [id, questionCell(id)]),
    ),
  ].join('\n');
};
