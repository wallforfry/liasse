import { TextExtractionError } from '../errors.ts';
import { runPoppler, type PopplerRunOptions } from './poppler.ts';

// `Page    3 size:  595.276 x 841.89 pts (A4)`
const PAGE_SIZE = /^Page\s+\d+\s+size:\s+(\S+)\s+x\s+(\S+)\s+pts/m;

// The longer edge of a page in points, as poppler measures it. The size has to come from
// poppler, which also renders the page: pdfjs applies `UserUnit` and poppler does not, so
// a size read with pdfjs can be a thousand times smaller than what is rendered.
export const readPageLongEdgePt = async (
  infoCommand: string,
  input: string,
  page: number,
  options: PopplerRunOptions,
): Promise<number> => {
  const pageArgument = String(page);
  const stdout = await runPoppler(
    infoCommand,
    ['-f', pageArgument, '-l', pageArgument, input],
    options,
  );
  const match = PAGE_SIZE.exec(stdout);
  const longEdgePt = Math.max(Number(match?.[1]), Number(match?.[2]));
  if (!Number.isFinite(longEdgePt)) {
    throw new TextExtractionError(
      'pdf_renderer_no_output',
      `The command ${infoCommand} did not report the size of page ${pageArgument}`,
    );
  }
  return longEdgePt;
};
