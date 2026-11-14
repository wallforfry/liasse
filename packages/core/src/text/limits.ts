import { DEFAULT_MAX_VISION_PAGES } from '../domain/limits.ts';

const MEBIBYTE = 1024 * 1024;

export interface TextLimits {
  readonly maxPdfPages: number;
  readonly maxVisionPages: number;
  readonly visionConcurrency: number;
  readonly renderTimeoutMs: number;
  readonly maxImageBytes: number;
  readonly maxHeicPixels: number;
  readonly maxHeicEdgePx: number;
  readonly maxDocxXmlBytes: number;
}

export const DEFAULT_TEXT_LIMITS: TextLimits = Object.freeze({
  maxPdfPages: 2000,
  maxVisionPages: DEFAULT_MAX_VISION_PAGES,
  visionConcurrency: 2,
  renderTimeoutMs: 30_000,
  // JPEG and PNG files are sent as they are: nothing here can decode and resize them.
  maxImageBytes: 10 * MEBIBYTE,
  // Decoding takes four bytes per pixel; 50 megapixels still admits a 48 MP phone photo.
  maxHeicPixels: 50_000_000,
  // Close to an A4 page at the 200 dpi used for scanned PDFs.
  maxHeicEdgePx: 2400,
  maxDocxXmlBytes: 20 * MEBIBYTE,
});

export const resolveTextLimits = (overrides: Partial<TextLimits> = {}): TextLimits => ({
  ...DEFAULT_TEXT_LIMITS,
  ...overrides,
});
