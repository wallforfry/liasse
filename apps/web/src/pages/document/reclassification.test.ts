import type { DocumentEvent } from '@liasse/sdk';
import { describe, expect, it } from 'vitest';
import { progressOf, reclassificationOf } from './reclassification.ts';

const event = (
  id: string,
  stage: DocumentEvent['stage'],
  outcome: DocumentEvent['outcome'] = 'succeeded',
): DocumentEvent => ({
  id,
  occurred_at: '2026-11-15T10:00:00.000Z',
  stage,
  outcome,
  status: 'indexed',
  attempt: null,
  max_attempts: null,
  error_code: outcome === 'failed' ? 'model_provider_failed' : null,
  error_name: null,
  http_status: null,
  provider_code: null,
  retryable: null,
  model: null,
  details: {},
});

const BEFORE = [event('evt_01', 'classification'), event('evt_02', 'extraction')];
const ASKED = reclassificationOf(BEFORE, 'invoice');

describe('progressOf', () => {
  it('waits for a classification logged after the request, past its retries', () => {
    expect(progressOf(ASKED, BEFORE, 'invoice')).toEqual({ step: 'classifying' });
    const retrying = [...BEFORE, event('evt_03', 'classification', 'retrying')];
    expect(progressOf(ASKED, retrying, 'invoice')).toEqual({ step: 'classifying' });
  });

  it('ends on a failed classification', () => {
    const failed = [...BEFORE, event('evt_03', 'classification', 'failed')];
    expect(progressOf(ASKED, failed, 'invoice')).toEqual({
      step: 'failed',
      errorCode: 'model_provider_failed',
    });
  });

  it('ends at once when the type did not change', () => {
    const same = [...BEFORE, event('evt_03', 'classification')];
    expect(progressOf(ASKED, same, 'invoice')).toEqual({ step: 'done', type: 'invoice' });
  });

  it('waits for the re-extraction a new type starts', () => {
    const classified = [...BEFORE, event('evt_03', 'classification')];
    expect(progressOf(ASKED, classified, 'water_bill')).toEqual({ step: 'extracting' });
    const extracted = [...classified, event('evt_04', 'reextraction')];
    expect(progressOf(ASKED, extracted, 'water_bill')).toEqual({
      step: 'done',
      type: 'water_bill',
    });
  });
});
