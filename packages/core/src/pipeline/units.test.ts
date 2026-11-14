import { describe, expect, it } from 'vitest';
import { ModelOutputError, ModelProviderError } from '../models/errors.ts';
import { PermanentJobError } from '../jobs/errors.ts';
import { StorageObjectNotFoundError } from '../storage/errors.ts';
import { TextExtractionError } from '../text/errors.ts';
import { documentConfidence, settledStatus, typeConfidence } from './confidence.ts';
import {
  DocumentProcessingError,
  documentErrorCode,
  isPermanentFailure,
  PipelineConflictError,
} from './errors.ts';
import { maskSyntheticIbans, SYNTHETIC_IBAN } from './harness.test-helper.ts';
import { createSensitiveMasker } from './sensitive-masker.ts';
import { TextProcessError } from './text-process/extract-in-child.ts';
import { openingOf, withinBudget } from './token-budget.ts';

describe('documentConfidence', () => {
  it('is the minimum of the classification and of the mean of the core values', () => {
    expect(documentConfidence(0.9, [1, 0.5])).toBe(0.75);
    expect(documentConfidence(0.6, [1, 0.8])).toBe(0.6);
  });

  it('is 0 for a document with no core value', () => {
    expect(documentConfidence(1, [])).toBe(0);
  });

  it('reads the confidence of the type from how it was obtained', () => {
    expect(typeConfidence({ manual: true })).toBe(1);
    expect(typeConfidence({ model: 'm', confidence: 0.4, outcome: 'existing' })).toBe(0.4);
    expect(typeConfidence(undefined)).toBe(0);
  });
});

describe('settledStatus', () => {
  const existing = { model: 'm', confidence: 1, outcome: 'existing' } as const;

  it.each([
    [0.7, existing, 'indexed'],
    [0.69, existing, 'needs_review'],
    [null, existing, 'needs_review'],
    [1, { ...existing, outcome: 'fallback' }, 'needs_review'],
    [1, { ...existing, outcome: 'untyped' }, 'needs_review'],
    [1, { ...existing, outcome: 'new' }, 'indexed'],
    [1, { manual: true }, 'indexed'],
  ] as const)('confidence %s with type %j is %s', (confidence, type, status) => {
    expect(settledStatus(confidence, type, 0.7)).toBe(status);
  });
});

describe('the error of a document', () => {
  const provider = (retryable: boolean) =>
    new ModelProviderError({ provider: 'p', model: 'm', retryable });

  it.each([
    [new TextExtractionError('pdf_encrypted', 'secret text'), 'pdf_encrypted', true],
    [new TextExtractionError('pdf_renderer_timeout', 'slow'), 'pdf_renderer_timeout', false],
    [new TextProcessError('text_memory_limit'), 'text_memory_limit', true],
    [new TextProcessError('text_process_crashed'), 'text_process_crashed', false],
    [provider(false), 'model_provider_failed', true],
    [provider(true), 'model_provider_failed', false],
    [new ModelOutputError('m', 'refused'), 'model_output_invalid', false],
    [new StorageObjectNotFoundError(), 'file_missing', true],
    [new DocumentProcessingError('no_text'), 'no_text', true],
    [new PermanentJobError('anything'), 'internal_error', true],
    [new PipelineConflictError('doc_1'), 'processing_conflict', false],
    [new Error('text of the document'), 'internal_error', false],
  ])('%s has the code %s, permanent: %s', (error, code, permanent) => {
    expect(documentErrorCode(error)).toBe(code);
    expect(isPermanentFailure(error)).toBe(permanent);
  });
});

describe('createSensitiveMasker', () => {
  it('replaces every span, whatever the lengths of the replacements', () => {
    const mask = createSensitiveMasker(
      (text) =>
        [...text.matchAll(/\d+/g)].map(({ 0: value, index }) => ({
          start: index,
          end: index + value.length,
          value,
        })),
      ({ value }) => `<${String(value.length)}>`,
    );
    expect(mask('a 1 bb 22222 c 33')).toBe('a <1> bb <5> c <2>');
    expect(mask('nothing')).toBe('nothing');
  });

  it('masks a synthetic IBAN and leaves a number that is not one', () => {
    expect(maskSyntheticIbans(`pay ${SYNTHETIC_IBAN} now`)).toBe('pay ****6789 now');
    expect(maskSyntheticIbans('pay DE37 9999 9999 0123 4567 88 now')).toContain('4567 88');
  });
});

describe('the token budget', () => {
  const pages = [
    { page: 1, text: 'a'.repeat(10) },
    { page: 2, text: 'b'.repeat(10) },
    { page: 3, text: 'c'.repeat(10) },
  ];

  it('takes the opening of a document across its pages', () => {
    expect(openingOf(pages, 3)).toBe(`${'a'.repeat(10)}\n\n`);
    expect(openingOf(pages, 100)).toHaveLength(34);
  });

  it('never leaves half of a surrogate pair at the cut', () => {
    expect(openingOf([{ page: 1, text: 'abc😀' }], 1)).toBe('abc');
  });

  it('keeps whole pages while they fit, then the beginning of the next', () => {
    expect(withinBudget(pages, 100)).toEqual({ pages, truncated: false });
    expect(withinBudget(pages, 4)).toEqual({
      pages: [pages[0], { page: 2, text: 'bbbbbb' }],
      truncated: true,
    });
    expect(withinBudget(pages, 5)).toEqual({ pages: pages.slice(0, 2), truncated: true });
    expect(withinBudget([], 5)).toEqual({ pages: [], truncated: false });
  });
});
