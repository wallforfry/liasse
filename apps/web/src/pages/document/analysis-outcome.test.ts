import type { DocumentEvent } from '@liasse/sdk';
import { describe, expect, it } from 'vitest';
import { analysisOutcomeOf } from './analysis-outcome.ts';

const event = (
  id: string,
  stage: DocumentEvent['stage'],
  outcome: DocumentEvent['outcome'],
  errorCode: string | null = null,
): DocumentEvent => ({
  id,
  occurred_at: '2026-11-15T10:05:00.000Z',
  stage,
  outcome,
  status: 'indexed',
  attempt: null,
  max_attempts: null,
  error_code: errorCode,
  error_name: null,
  http_status: null,
  provider_code: null,
  retryable: null,
  model: null,
  details: {},
});

const OLD = event('evt_old', 'reextraction', 'failed', 'internal_error');

describe('analysisOutcomeOf', () => {
  const seen = new Set([OLD.id]);

  it('ends done with the type the document has, once a new writing stage succeeded', () => {
    const events = [OLD, event('evt_1', 'classification', 'succeeded')];
    expect(analysisOutcomeOf(seen, events, 'water_bill')).toEqual({
      kind: 'done',
      type: 'water_bill',
    });
  });

  it('ends failed with the code of the last new failure, retries left aside', () => {
    const events = [
      OLD,
      event('evt_1', 'classification', 'retrying', 'timeout'),
      event('evt_2', 'classification', 'failed', 'model_provider_failed'),
    ];
    expect(analysisOutcomeOf(seen, events, 'note')).toEqual({
      kind: 'failed',
      errorCode: 'model_provider_failed',
    });
  });

  it('ends unchanged when nothing new was written, whatever the log held before', () => {
    const events = [OLD, event('evt_1', 'indexing', 'succeeded')];
    expect(analysisOutcomeOf(seen, events, 'note')).toEqual({ kind: 'unchanged' });
  });
});
