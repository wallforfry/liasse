import type { SupportedMime } from '../domain/enums.ts';
import type { VisionModel } from '../models/ports.ts';
import type { TextLimits } from './limits.ts';

export const TEXT_EXTRACTION_METHODS = ['native', 'vision'] as const;
export type TextExtractionMethod = (typeof TEXT_EXTRACTION_METHODS)[number];

export interface ExtractTextInput {
  readonly bytes: Uint8Array;
  readonly mime: SupportedMime;
}

export interface PdfRendererOptions {
  // The `pdftoppm` executable, looked up in PATH unless it is a path.
  readonly command: string;
  // Where the private directory holding the PDF and its rendered pages is created.
  readonly tempRoot: string;
}

export interface ExtractTextDeps {
  readonly vision: VisionModel;
  readonly signal?: AbortSignal;
  readonly limits?: Partial<TextLimits>;
  readonly pdfRenderer?: Partial<PdfRendererOptions>;
}

export interface ExtractedPage {
  readonly page: number;
  readonly text: string;
}

export interface ExtractedAttachment {
  readonly filename: string;
  readonly mime: string;
  readonly bytes: Uint8Array;
  // Displayed inside the message body (a logo, a pasted picture) rather than attached to it.
  readonly inline: boolean;
}

export interface ExtractedText {
  readonly pages: readonly ExtractedPage[];
  readonly method: TextExtractionMethod;
  readonly visionModel?: string;
  readonly attachments: readonly ExtractedAttachment[];
}

export interface ExtractionContext {
  readonly vision: VisionModel;
  readonly signal: AbortSignal | undefined;
  readonly limits: TextLimits;
  readonly pdfRenderer: PdfRendererOptions;
}
