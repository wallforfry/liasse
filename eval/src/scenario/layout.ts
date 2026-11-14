import type { PaperName } from '../render/paper.ts';
import { companyLine, PARTIES } from './cast.ts';
import type { RenderSpec } from './model.ts';

type PartyName = keyof typeof PARTIES;

// The top of a letter: who writes, from where, and how to reach them.
export const letterhead = (name: PartyName, contact = ''): readonly string[] => {
  const { printed, address } = PARTIES[name];
  const company = companyLine(name);
  const third = [company, contact].filter((part) => part !== '').join(' - ');
  return [printed, address, ...(third === '' ? [] : [third]), ''];
};

export const ADDRESSEE: readonly string[] = [
  'Mme Jane Doe',
  '4 allée des Hirondelles',
  '99120 Trévolzac-sur-Yvrelle',
  '',
];

// What Jane puts at the top of a letter she writes.
export const SENDER: readonly string[] = [
  'Jane Doe',
  '4 allée des Hirondelles',
  '99120 Trévolzac-sur-Yvrelle',
  'jane.doe@example.org',
  '',
];

export const pdf = (...pages: readonly (readonly string[])[]): RenderSpec => ({
  kind: 'pdf',
  pages: pages.map((lines) => ({ lines })),
});

export const scannedPdf = (
  paper: PaperName,
  ...pages: readonly (readonly string[])[]
): RenderSpec => ({
  kind: 'pdf',
  pages: pages.map((lines) => ({ lines, scan: paper })),
});

const WRAP_WIDTH = 72;

// Breaks a paragraph into the lines of a typed letter.
export const wrap = (paragraph: string, width = WRAP_WIDTH): readonly string[] =>
  paragraph.split(' ').reduce<readonly string[]>((lines, word) => {
    const last = lines.at(-1);
    return last === undefined || `${last} ${word}`.length > width
      ? [...lines, word]
      : [...lines.slice(0, -1), `${last} ${word}`];
  }, []);

const COLUMN_WIDTH = 38;

// Two blocks side by side, as a letter sets its reference on the left and its addressee
// on the right.
export const twoColumns = (left: readonly string[], right: readonly string[]): readonly string[] =>
  Array.from({ length: Math.max(left.length, right.length) }, (_, row) =>
    `${(left[row] ?? '').padEnd(COLUMN_WIDTH)}${right[row] ?? ''}`.trimEnd(),
  );

const LABEL_WIDTH = 30;
const FIGURE_WIDTHS = [9, 7, 10] as const;

// A label, then the figures of its columns.
type Row = readonly string[];

const tableRow = ([label = '', ...figures]: Row): string =>
  [
    label.padEnd(LABEL_WIDTH),
    ...FIGURE_WIDTHS.map((width, column) => (figures[column] ?? '').padStart(width)),
  ].join(' | ');

// A ruled table of figures: a label and up to three right-aligned columns.
export const table = (header: Row, rows: readonly Row[]): readonly string[] => {
  const rule = '-'.repeat(tableRow(header).length);
  return [rule, tableRow(header), rule, ...rows.map(tableRow), rule];
};

// Marks the first page of a scanned document with a rubber stamp.
export const stamped = (render: RenderSpec, text: string): RenderSpec =>
  render.kind === 'pdf'
    ? {
        ...render,
        pages: render.pages.map((page, index) => (index === 0 ? { ...page, stamp: text } : page)),
      }
    : render;
