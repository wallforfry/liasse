import { describe, expect, it } from 'vitest';
import { TEXT_EXTRACTION_ERROR_CODES, TextExtractionError } from './errors.ts';

describe('TextExtractionError', () => {
  it('says for each code whether trying again can succeed', () => {
    const retryable = TEXT_EXTRACTION_ERROR_CODES.filter(
      (code) => new TextExtractionError(code, 'synthetic').retryable,
    );
    expect(retryable).toEqual(['pdf_renderer_timeout', 'pdf_renderer_failed']);
  });

  it('keeps its code, message and cause', () => {
    const cause = new Error('underlying');
    const error = new TextExtractionError('pdf_corrupt', 'The PDF could not be read', { cause });
    expect(error).toMatchObject({
      name: 'TextExtractionError',
      code: 'pdf_corrupt',
      message: 'The PDF could not be read',
      retryable: false,
      cause,
    });
  });
});
