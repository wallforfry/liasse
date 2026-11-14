import { describe, expect, it } from 'vitest';
import { createHttpMetrics, renderMetrics } from './metrics.ts';

const PROCESS = { uptimeSeconds: 12.5, cpuSeconds: 0.75, residentBytes: 1024, heapUsedBytes: 512 };
const EMPTY = { documents: [], jobs: [], queueDepth: 0, oldestQueuedAgeSeconds: 0 };

describe('renderMetrics', () => {
  it('escapes what a label value may hold, so one value cannot forge a sample', () => {
    const text = renderMetrics({
      process: PROCESS,
      http: [],
      stats: {
        ...EMPTY,
        jobs: [{ kind: 'odd"kind\\with\nbreak"} 1\nforged_metric 9', status: 'queued', count: 2 }],
      },
    });
    expect(text.split('\n')).toContain(
      'liasse_jobs{kind="odd\\"kind\\\\with\\nbreak\\"} 1\\nforged_metric 9",status="queued"} 2',
    );
    expect(text).not.toMatch(/^forged_metric/m);
  });

  it('counts requests by method, route and status', () => {
    const metrics = createHttpMetrics();
    const request = { method: 'GET', route: '/documents/:id', status: 200 };
    metrics.observe(request);
    metrics.observe(request);
    metrics.observe({ ...request, status: 404 });
    expect(metrics.snapshot()).toEqual([
      { ...request, count: 2 },
      { ...request, status: 404, count: 1 },
    ]);
  });

  it('reports every live status, the queue and the process', () => {
    const text = renderMetrics({
      process: PROCESS,
      http: [],
      stats: {
        documents: [{ status: 'indexed', count: 3 }],
        jobs: [],
        queueDepth: 4,
        oldestQueuedAgeSeconds: 61.5,
      },
    });
    const lines = text.split('\n');
    expect(lines).toEqual(
      expect.arrayContaining([
        'process_uptime_seconds 12.5',
        'process_cpu_seconds_total 0.75',
        'process_resident_memory_bytes 1024',
        'nodejs_heap_used_bytes 512',
        'liasse_documents{status="received"} 0',
        'liasse_documents{status="indexed"} 3',
        'liasse_documents{status="needs_review"} 0',
        'liasse_job_queue_depth 4',
        'liasse_job_queue_oldest_age_seconds 61.5',
      ]),
    );
    expect(lines.filter((line) => line.startsWith('liasse_documents{'))).toHaveLength(6);
    expect(text.endsWith('\n')).toBe(true);
  });
});
