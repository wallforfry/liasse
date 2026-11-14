import { TextExtractionError } from '../errors.ts';
import { createLineScanner } from './line-scanner.ts';
import { runPoppler, type PopplerRunOptions } from './poppler.ts';

export type PageMeasure =
  | { readonly kind: 'sized'; readonly longEdgePt: number }
  // No area to render: a crop box outside the media box is reported as 0 x 0.
  | { readonly kind: 'degenerate' }
  // Reported more than once: one of the lines was not written by poppler for this page.
  | { readonly kind: 'ambiguous' };

export interface PageSizeReader {
  readonly push: (chunk: Uint8Array) => void;
  /** The size read from everything pushed. To be called once, after the last chunk. */
  readonly measure: () => PageMeasure;
}

// Several times the longest size line `pdfinfo` writes, paper name included.
const MAX_SIZE_LINE_BYTES = 1024;

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

const toMeasure = (width: string, height: string, page: number): PageMeasure => {
  if (!DECIMAL.test(width) || !DECIMAL.test(height)) throw notReported(page);
  const edges = [Number(width), Number(height)];
  if (!edges.every(Number.isFinite)) throw notReported(page);
  return edges.some((edge) => edge <= 0)
    ? { kind: 'degenerate' }
    : { kind: 'sized', longEdgePt: Math.max(...edges) };
};

// `pdfinfo` prints strings that come from the file both before the page sizes (title,
// subject, keywords...) and after them (the PDF subtype), of any length. The whole output
// is therefore read, as a stream of which only the first size line and the number of
// size lines are kept: a size is neither missed behind a long string nor counted once
// when it was written twice. `pdfinfo` replaces the line feeds those strings hold, not
// every character a multiline pattern takes for a line start (U+2028, U+2029), so a size
// is only read from a whole line, lines being cut at line feeds alone. Should a forged
// line still get through, the size is then reported twice and trusted in neither.
export const createPageSizeReader = (page: number): PageSizeReader => {
  const sizeLine = sizeLineOf(page);
  let first: RegExpExecArray | undefined;
  let count = 0;
  const scanner = createLineScanner(MAX_SIZE_LINE_BYTES, (line) => {
    const match = sizeLine.exec(line);
    if (match === null) return;
    first ??= match;
    count += 1;
  });
  return {
    push: scanner.push,
    measure: () => {
      scanner.end();
      if (first === undefined) throw notReported(page);
      if (count > 1) return { kind: 'ambiguous' };
      const [, width = '', height = ''] = first;
      return toMeasure(width, height, page);
    },
  };
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
  const reader = createPageSizeReader(page);
  await runPoppler(
    infoCommand,
    ['-f', pageArgument, '-l', pageArgument, input],
    options,
    reader.push,
  );
  return reader.measure();
};
