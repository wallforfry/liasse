import type { SupportedMime } from '@liasse/contract/domain';
import type { VisionModel } from '../models/ports.ts';
import type { TextLimits } from './limits.ts';

// Where the text of one page comes from: the file itself, or the vision model.
export const PAGE_TEXT_METHODS = ['native', 'vision'] as const;
export type PageTextMethod = (typeof PAGE_TEXT_METHODS)[number];

// For a whole document, `mixed` when its pages do not all share one method.
export const TEXT_EXTRACTION_METHODS = [...PAGE_TEXT_METHODS, 'mixed'] as const;
export type TextExtractionMethod = (typeof TEXT_EXTRACTION_METHODS)[number];

export interface ExtractTextInput {
  readonly bytes: Uint8Array;
  readonly mime: SupportedMime;
}

export interface PdfRendererOptions {
  // The `pdftoppm` executable, looked up in PATH unless it is a path.
  readonly command: string;
  // The `pdfinfo` executable of the same poppler, asked for the size of a page.
  readonly infoCommand: string;
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
  readonly method: PageTextMethod;
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
