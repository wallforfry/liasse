import { DEFAULT_MAX_VISION_PAGES } from '../domain/limits.ts';

const MEBIBYTE = 1024 * 1024;

export interface TextLimits {
  readonly maxPdfPages: number;
  readonly maxVisionPages: number;
  readonly visionConcurrency: number;
  readonly renderTimeoutMs: number;
  readonly maxRenderEdgePx: number;
  readonly maxImageBytes: number;
  readonly maxHeicPixels: number;
  readonly maxHeicEdgePx: number;
  readonly maxDocxXmlBytes: number;
  readonly maxDocxXmlNodes: number;
  readonly maxDocxTextChars: number;
}

export const DEFAULT_TEXT_LIMITS: TextLimits = Object.freeze({
  maxPdfPages: 2000,
  maxVisionPages: DEFAULT_MAX_VISION_PAGES,
  visionConcurrency: 2,
  renderTimeoutMs: 30_000,
  // The long edge of an A3 page at the 200 dpi scanned pages are rendered at.
  maxRenderEdgePx: 3308,
  // JPEG and PNG files are sent as they are: nothing here can decode and resize them.
  maxImageBytes: 10 * MEBIBYTE,
  // Decoding takes four bytes per pixel; 50 megapixels still admits a 48 MP phone photo.
  maxHeicPixels: 50_000_000,
  // Close to an A4 page at the 200 dpi used for scanned PDFs.
  maxHeicEdgePx: 2400,
  // The main part of a real document rarely exceeds a few megabytes; parsing costs
  // several times its size in memory.
  maxDocxXmlBytes: 8 * MEBIBYTE,
  // About the text of a 600-page book.
  maxDocxTextChars: 2_000_000,
  // An element costs a few hundred bytes once parsed and rendered: a document close to
  // this limit was measured at about 165 MB above an idle process.
  maxDocxXmlNodes: 250_000,
});

export const resolveTextLimits = (overrides: Partial<TextLimits> = {}): TextLimits => ({
  ...DEFAULT_TEXT_LIMITS,
  ...overrides,
});
