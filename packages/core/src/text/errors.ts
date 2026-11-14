export const TEXT_EXTRACTION_ERROR_CODES = [
  'pdf_encrypted',
  'pdf_corrupt',
  'pdf_no_pages',
  'pdf_too_many_pages',
  'pdf_too_many_scanned_pages',
  'pdf_renderer_missing',
  'pdf_renderer_timeout',
  'pdf_renderer_failed',
  'image_corrupt',
  'image_too_large',
  'docx_corrupt',
  'docx_too_large',
  'eml_corrupt',
] as const;
export type TextExtractionErrorCode = (typeof TEXT_EXTRACTION_ERROR_CODES)[number];

// The document itself, or the machine it is read on, prevents extraction: trying again
// with the same input gives the same result. A failed vision call is not one of these
// and propagates unchanged.
export class TextExtractionError extends Error {
  override readonly name = 'TextExtractionError';
  readonly code: TextExtractionErrorCode;

  constructor(code: TextExtractionErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
  }
}

export const isAbortError = (error: unknown): boolean =>
  error instanceof Error && error.name === 'AbortError';
