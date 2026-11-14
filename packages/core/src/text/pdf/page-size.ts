import { TextExtractionError } from '../errors.ts';
import { runPoppler, type PopplerRunOptions } from './poppler.ts';

export type PageMeasure =
  | { readonly kind: 'sized'; readonly longEdgePt: number }
  // No area to render: a crop box outside the media box is reported as 0 x 0.
  | { readonly kind: 'degenerate' }
  // Reported more than once: one of the lines was not written by poppler for this page.
  | { readonly kind: 'ambiguous' };

// What `pdfinfo` prints with `%g`: 595.276, 9000, 1e+06.
const DECIMAL = /^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i;

// `Page    3 size:  595.276 x 841.89 pts (A4)`, the whole line and nothing else.
const sizeLineOf = (page: number): RegExp =>
  new RegExp(`^Page +${String(page)} size: +(\\S+) x (\\S+) pts(?: \\(.*\\))?$`);

const notReported = (page: number): TextExtractionError =>
  new TextExtractionError(
    'pdf_renderer_no_output',
    `pdfinfo did not report the size of page ${String(page)}`,
  );

// `pdfinfo` prints the document information (title, subject, keywords...) before the page
// sizes, and those strings come from the file. It replaces the line feeds they hold, not
// every character a multiline pattern takes for a line start (U+2028, U+2029), so a size
// is only read from a whole line, lines being cut at line feeds alone. Should a forged
// line still get through, the size is then reported twice and trusted in neither.
export const parsePageSize = (stdout: string, page: number): PageMeasure => {
  const sizeLine = sizeLineOf(page);
  const matches = stdout.split('\n').flatMap((line) => {
    const match = sizeLine.exec(line);
    return match === null ? [] : [match];
  });
  const [match] = matches;
  if (match === undefined) throw notReported(page);
  if (matches.length > 1) return { kind: 'ambiguous' };
  const [, width = '', height = ''] = match;
  if (!DECIMAL.test(width) || !DECIMAL.test(height)) throw notReported(page);
  const edges = [Number(width), Number(height)];
  if (!edges.every(Number.isFinite)) throw notReported(page);
  return edges.some((edge) => edge <= 0)
    ? { kind: 'degenerate' }
    : { kind: 'sized', longEdgePt: Math.max(...edges) };
};

// The size has to come from poppler, which also renders the page: pdfjs applies
// `UserUnit` and poppler does not, so a size read with pdfjs can be a thousand times
// smaller than what is rendered.
export const measurePage = async (
  infoCommand: string,
  input: string,
  page: number,
  options: PopplerRunOptions,
): Promise<PageMeasure> => {
  const pageArgument = String(page);
  const stdout = await runPoppler(
    infoCommand,
    ['-f', pageArgument, '-l', pageArgument, input],
    options,
  );
  return parsePageSize(stdout, page);
};
