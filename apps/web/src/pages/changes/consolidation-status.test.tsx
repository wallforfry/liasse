import type { ConsolidationRunView } from '@liasse/sdk';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ConsolidationStatus } from './consolidation-status.tsx';

const RUN: ConsolidationRunView = {
  id: 'job_02',
  trigger: 'manual',
  status: 'queued',
  attempts: 0,
  queued_at: '2026-11-17T09:00:00.000Z',
  due_at: '2026-11-17T09:00:00.000Z',
  last_error: null,
};

const OLDER: ConsolidationRunView = { ...RUN, id: 'job_01', status: 'succeeded', attempts: 1 };

const statusOf = (latest: ConsolidationRunView): string | null => {
  render(<ConsolidationStatus runs={[latest, OLDER]} />);
  return screen.getByRole('status').textContent;
};

describe('the state of the latest consolidation run', () => {
  it.each<readonly [string, Partial<ConsolidationRunView>, string]>([
    ['queued', {}, 'A consolidation run is queued.'],
    ['running', { status: 'running', attempts: 1 }, 'Consolidation is running.'],
    [
      'waiting for a retry',
      { attempts: 1, last_error: 'Error: timeout', due_at: '2026-11-17T09:05:00.000Z' },
      'An attempt failed, the run will try again: Error: timeout',
    ],
    [
      'failed',
      { status: 'failed', attempts: 3, last_error: 'Error: the text model refused the request' },
      'The latest consolidation run failed (manual run of 2026-11-17 09:00 UTC): ' +
        'Error: the text model refused the request',
    ],
    [
      'finished',
      { status: 'succeeded', attempts: 1, trigger: 'batch' },
      'The latest consolidation run finished (batch run of 2026-11-17 09:00 UTC).',
    ],
  ])('says when it is %s', (_, change, text) => {
    expect(statusOf({ ...RUN, ...change })).toBe(text);
  });

  it('says nothing before the first run', () => {
    render(<ConsolidationStatus runs={[]} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
