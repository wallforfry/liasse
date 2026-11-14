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

const readPage = async (document: PdfDocument, pageNumber: number): Promise<string> => {
  const page = await document.getPage(pageNumber);
  try {
    const { items } = await page.getTextContent();
    return items
      .map((item) => ('str' in item ? `${item.str}${item.hasEOL ? '\n' : ''}` : ''))
      .join('');
  } finally {
    page.cleanup();
  }
};

// Returns the text layer of every page, in page order; a page without one gives ''.
export const readPdfTextLayer = async (
  bytes: Uint8Array,
  limits: TextLimits,
  signal: AbortSignal | undefined,
): Promise<readonly string[]> => {
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
    const pages: string[] = [];
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
