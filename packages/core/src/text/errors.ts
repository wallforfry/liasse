export const TEXT_EXTRACTION_ERROR_CODES = [
  'unsupported_mime',
  'pdf_encrypted',
  'pdf_corrupt',
  'pdf_no_pages',
  'pdf_too_many_pages',
  'pdf_too_many_scanned_pages',
  'pdf_renderer_missing',
  'pdf_renderer_timeout',
  'pdf_renderer_failed',
  'pdf_renderer_no_output',
  'pdf_page_unrenderable',
  'image_corrupt',
  'image_too_large',
  'docx_corrupt',
  'docx_too_large',
  'eml_corrupt',
] as const;
export type TextExtractionErrorCode = (typeof TEXT_EXTRACTION_ERROR_CODES)[number];

// Whether the same input can succeed on another attempt. A renderer that ran out of time
// or was killed may have been starved by the machine; a document that is corrupt, too
// large or refused by a limit fails the same way every time, and a missing binary needs
// the operator.
const RETRYABLE: Readonly<Record<TextExtractionErrorCode, boolean>> = {
  unsupported_mime: false,
  pdf_encrypted: false,
  pdf_corrupt: false,
  pdf_no_pages: false,
  pdf_too_many_pages: false,
  pdf_too_many_scanned_pages: false,
  pdf_renderer_missing: false,
  pdf_renderer_timeout: true,
  pdf_renderer_failed: true,
  pdf_renderer_no_output: false,
  pdf_page_unrenderable: false,
  image_corrupt: false,
  image_too_large: false,
  docx_corrupt: false,
  docx_too_large: false,
  eml_corrupt: false,
};

// Extraction could not produce text, for the reason named by `code`; `retryable` tells a
// job queue what to do with it. A failed vision call is not one of these and propagates
// unchanged.
export class TextExtractionError extends Error {
  override readonly name = 'TextExtractionError';
  readonly code: TextExtractionErrorCode;
  readonly retryable: boolean;

  constructor(code: TextExtractionErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
    this.retryable = RETRYABLE[code];
  }
}

export const isAbortError = (error: unknown): boolean =>
  error instanceof Error && error.name === 'AbortError';
