import { isAbortError, TextExtractionError } from '../errors.ts';
import type { TextLimits } from '../limits.ts';

// The legacy build is the one that runs on Node. It is imported on first use: the
// library is large and most documents of an idle server are not PDFs being read.
const loadPdfjs = () => import('pdfjs-dist/legacy/build/pdf.mjs');

type Pdfjs = Awaited<ReturnType<typeof loadPdfjs>>;
type PdfDocument = Awaited<ReturnType<Pdfjs['getDocument']>['promise']>;

const SILENT = 0;

const toExtractionError = (error: unknown): unknown => {
  if (error instanceof TextExtractionError || isAbortError(error)) return error;
  if (error instanceof Error && error.name === 'PasswordException') {
    return new TextExtractionError('pdf_encrypted', 'The PDF is protected by a password', {
      cause: error,
    });
  }
  return new TextExtractionError('pdf_corrupt', 'The PDF could not be read', { cause: error });
};

const assertPageCount = (pages: number, { maxPdfPages }: TextLimits): void => {
  if (pages === 0) throw new TextExtractionError('pdf_no_pages', 'The PDF has no page');
  if (pages > maxPdfPages) {
    throw new TextExtractionError(
      'pdf_too_many_pages',
      `The PDF has ${String(pages)} pages, more than the limit of ${String(maxPdfPages)}`,
    );
  }
};

export interface PdfPageLayer {
  // The text layer as stored; '' for a page without one.
  readonly text: string;
  // The longer edge of the visible box of the page, in points.
  readonly longEdgePt: number;
}

const readPage = async (document: PdfDocument, pageNumber: number): Promise<PdfPageLayer> => {
  const page = await document.getPage(pageNumber);
  try {
    const { items } = await page.getTextContent();
    const [left = 0, bottom = 0, right = 0, top = 0] = page.view;
    return {
      text: items
        .map((item) => ('str' in item ? `${item.str}${item.hasEOL ? '\n' : ''}` : ''))
        .join(''),
      // `UserUnit` scales the page. Counting it can only overestimate the size, which
      // lowers the resolution; ignoring it would let a renderer that honours it exceed
      // the pixel budget.
      longEdgePt: Math.max(Math.abs(right - left), Math.abs(top - bottom)) * page.userUnit,
    };
  } finally {
    page.cleanup();
  }
};

// Returns the text layer and the size of every page, in page order.
export const readPdfPages = async (
  bytes: Uint8Array,
  limits: TextLimits,
  signal: AbortSignal | undefined,
): Promise<readonly PdfPageLayer[]> => {
  const pdfjs = await loadPdfjs();
  // pdfjs takes ownership of the buffer it is given, and the caller still needs its own.
  const loading = pdfjs.getDocument({
    data: bytes.slice(),
    verbosity: SILENT,
    useSystemFonts: false,
  });
  try {
    const document = await loading.promise;
    assertPageCount(document.numPages, limits);
    const pages: PdfPageLayer[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      signal?.throwIfAborted();
      pages.push(await readPage(document, pageNumber));
    }
    return pages;
  } catch (error) {
    throw toExtractionError(error);
  } finally {
    await loading.destroy();
  }
};
