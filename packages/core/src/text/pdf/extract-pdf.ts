import { mapWithConcurrency } from '../concurrency.ts';
import { TextExtractionError } from '../errors.ts';
import { normalizeText } from '../normalize.ts';
import { transcribePageImage, visionResult } from '../transcribe.ts';
import type { ExtractedText, ExtractionContext } from '../types.ts';
import { readPdfTextLayer } from './native-text.ts';
import { withPdfPageRenderer } from './render.ts';

export const NATIVE_PDF_MIN_CHARS_PER_PAGE = 100;

const countCharacters = (text: string): number => Array.from(text.replace(/\s/g, '')).length;

// Whitespace is not counted: a text layer made of spacing only is not usable text.
export const hasNativeText = (pageTexts: readonly string[]): boolean =>
  pageTexts.reduce((total, text) => total + countCharacters(text), 0) >=
  NATIVE_PDF_MIN_CHARS_PER_PAGE * pageTexts.length;

const transcribeEveryPage = async (
  bytes: Uint8Array,
  pageCount: number,
  context: ExtractionContext,
): Promise<ExtractedText> => {
  const { limits, signal, pdfRenderer } = context;
  if (pageCount > limits.maxVisionPages) {
    throw new TextExtractionError(
      'pdf_too_many_scanned_pages',
      `The PDF has no text layer and ${String(pageCount)} pages, more than the limit of ${String(limits.maxVisionPages)} pages sent to the vision model`,
    );
  }
  const pageNumbers = Array.from({ length: pageCount }, (_, index) => index + 1);
  const transcriptions = await withPdfPageRenderer(
    { ...pdfRenderer, bytes, timeoutMs: limits.renderTimeoutMs, signal },
    (renderer) =>
      mapWithConcurrency(pageNumbers, limits.visionConcurrency, async (page) =>
        transcribePageImage(await renderer.renderPage(page), context),
      ),
  );
  return visionResult(transcriptions);
};

export const extractPdf = async (
  bytes: Uint8Array,
  context: ExtractionContext,
): Promise<ExtractedText> => {
  const layer = await readPdfTextLayer(bytes, context.limits, context.signal);
  const pageTexts = layer.map(normalizeText);
  if (!hasNativeText(pageTexts)) return transcribeEveryPage(bytes, pageTexts.length, context);
  return {
    pages: pageTexts.map((text, index) => ({ page: index + 1, text })),
    method: 'native',
    attachments: [],
  };
};
