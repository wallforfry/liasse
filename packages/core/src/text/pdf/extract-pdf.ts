import { mapWithConcurrency } from '../concurrency.ts';
import { TextExtractionError } from '../errors.ts';
import { normalizeText } from '../normalize.ts';
import { toExtractedText, type PageText } from '../result.ts';
import { transcribePageImage } from '../transcribe.ts';
import type { ExtractedText, ExtractionContext } from '../types.ts';
import { readPdfPages } from './native-text.ts';
import { withPdfPageRenderer, type PdfPageToRender } from './render.ts';

// A document is native when its pages hold this many characters on average.
export const NATIVE_PDF_MIN_CHARS_PER_PAGE = 100;
// Below this many characters a page has no usable text layer: a scan inside a native
// document, or a page whose only text is a page number or a stamp.
export const NATIVE_PAGE_MIN_CHARS = 20;

interface PdfPage extends PdfPageToRender {
  readonly text: string;
  // Whitespace is not counted: a text layer made of spacing only is not usable text.
  readonly characters: number;
}

const countCharacters = (text: string): number => Array.from(text.replace(/\s/g, '')).length;

const isNativeDocument = (pages: readonly PdfPage[]): boolean =>
  pages.reduce((total, { characters }) => total + characters, 0) >=
  NATIVE_PDF_MIN_CHARS_PER_PAGE * pages.length;

// A scanned document is transcribed whole, as long as it fits the vision budget. In a
// native document, and in a scanned one too long for the budget, only the pages without
// a usable text layer are: the text that exists is never thrown away.
const pagesForVision = (pages: readonly PdfPage[], maxVisionPages: number): readonly PdfPage[] => {
  const selected =
    !isNativeDocument(pages) && pages.length <= maxVisionPages
      ? pages
      : pages.filter(({ characters }) => characters < NATIVE_PAGE_MIN_CHARS);
  if (selected.length > maxVisionPages) {
    throw new TextExtractionError(
      'pdf_too_many_scanned_pages',
      `${String(selected.length)} of the ${String(pages.length)} pages of the PDF have no usable text layer, more than the limit of ${String(maxVisionPages)} pages sent to the vision model`,
    );
  }
  return selected;
};

const transcribePages = async (
  bytes: Uint8Array,
  pages: readonly PdfPage[],
  context: ExtractionContext,
): Promise<ReadonlyMap<number, PageText>> => {
  const { limits, signal, pdfRenderer } = context;
  const request = {
    ...pdfRenderer,
    bytes,
    timeoutMs: limits.renderTimeoutMs,
    maxEdgePx: limits.maxRenderEdgePx,
    signal,
  };
  const transcribed = await withPdfPageRenderer(request, (renderer) =>
    mapWithConcurrency(pages, limits.visionConcurrency, async (page) => {
      const { text, model } = await transcribePageImage(await renderer.renderPage(page), context);
      return [page.number, { text, visionModel: model }] as const;
    }),
  );
  return new Map(transcribed);
};

export const extractPdf = async (
  bytes: Uint8Array,
  context: ExtractionContext,
): Promise<ExtractedText> => {
  const layers = await readPdfPages(bytes, context.limits, context.signal);
  const pages = layers.map(({ text, longEdgePt }, index): PdfPage => {
    const normalized = normalizeText(text);
    return {
      number: index + 1,
      longEdgePt,
      text: normalized,
      characters: countCharacters(normalized),
    };
  });
  const forVision = pagesForVision(pages, context.limits.maxVisionPages);
  const transcribed =
    forVision.length === 0
      ? new Map<number, PageText>()
      : await transcribePages(bytes, forVision, context);
  return toExtractedText(pages.map(({ number, text }) => transcribed.get(number) ?? { text }));
};
