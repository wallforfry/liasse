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
  '4 allée des Sorbiers',
  '99120 Valmont-sur-Orbe',
  '',
];

// What Jane puts at the top of a letter she writes.
export const SENDER: readonly string[] = [
  'Jane Doe',
  '4 allée des Sorbiers',
  '99120 Valmont-sur-Orbe',
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
