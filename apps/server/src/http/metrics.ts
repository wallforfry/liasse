import { DOCUMENT_STATUSES, isLiveStatus } from '@liasse/contract/domain';
import type { Stats } from '@liasse/core/api';

export const METRICS_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';

interface RequestKey {
  readonly method: string;
  /** The route template, such as `/documents/:id`: never the path that was asked. */
  readonly route: string;
  readonly status: number;
}

export interface HttpMetrics {
  readonly observe: (request: RequestKey) => void;
  readonly snapshot: () => readonly (RequestKey & { readonly count: number })[];
}

export const createHttpMetrics = (): HttpMetrics => {
  const counts = new Map<string, RequestKey & { readonly count: number }>();
  return {
    observe: (request) => {
      const key = `${request.method} ${request.route} ${String(request.status)}`;
      counts.set(key, { ...request, count: (counts.get(key)?.count ?? 0) + 1 });
    },
    snapshot: () => [...counts.values()],
  };
};

export interface ProcessStats {
  readonly uptimeSeconds: number;
  readonly cpuSeconds: number;
  readonly residentBytes: number;
  readonly heapUsedBytes: number;
}

export const readProcessStats = (): ProcessStats => {
  const { user, system } = process.cpuUsage();
  const { rss, heapUsed } = process.memoryUsage();
  return {
    uptimeSeconds: process.uptime(),
    cpuSeconds: (user + system) / 1_000_000,
    residentBytes: rss,
    heapUsedBytes: heapUsed,
  };
};

type Labels = Readonly<Record<string, string | number>>;

interface Sample {
  readonly labels?: Labels;
  readonly value: number;
}

interface Family {
  readonly name: string;
  readonly help: string;
  readonly type: 'counter' | 'gauge';
  readonly samples: readonly Sample[];
}

// The three characters the text format escapes in a label value.
const escapeLabel = (value: string | number): string =>
  String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n');

const renderLabels = (labels: Labels = {}): string => {
  const pairs = Object.entries(labels).map(([name, value]) => `${name}="${escapeLabel(value)}"`);
  return pairs.length === 0 ? '' : `{${pairs.join(',')}}`;
};

const renderFamily = ({ name, help, type, samples }: Family): string =>
  [
    `# HELP ${name} ${help}`,
    `# TYPE ${name} ${type}`,
    ...samples.map(({ labels, value }) => `${name}${renderLabels(labels)} ${String(value)}`),
  ].join('\n');

const gauge = (name: string, help: string, value: number): Family => ({
  name,
  help,
  type: 'gauge',
  samples: [{ value }],
});

export interface MetricsInput {
  readonly process: ProcessStats;
  readonly http: ReturnType<HttpMetrics['snapshot']>;
  readonly stats: Stats;
}

/**
 * The Prometheus text exposition. Labels are route templates, statuses and job kinds:
 * nothing read from a document, a request path or a credential.
 */
export const renderMetrics = ({
  process: stats,
  http,
  stats: { documents, jobs, ...queue },
}: MetricsInput): string => {
  const families: readonly Family[] = [
    gauge('process_uptime_seconds', 'Seconds since the process started.', stats.uptimeSeconds),
    {
      name: 'process_cpu_seconds_total',
      help: 'User and system CPU time spent by the process.',
      type: 'counter',
      samples: [{ value: stats.cpuSeconds }],
    },
    gauge('process_resident_memory_bytes', 'Resident memory of the process.', stats.residentBytes),
    gauge('nodejs_heap_used_bytes', 'Used JavaScript heap.', stats.heapUsedBytes),
    {
      name: 'liasse_http_requests_total',
      help: 'HTTP requests answered, by method, route template and status.',
      type: 'counter',
      samples: http.map(({ count, ...labels }) => ({ labels, value: count })),
    },
    {
      name: 'liasse_documents',
      help: 'Documents by status, deleted ones left out.',
      type: 'gauge',
      samples: DOCUMENT_STATUSES.filter(isLiveStatus).map((status) => ({
        labels: { status },
        value: documents.find((row) => row.status === status)?.count ?? 0,
      })),
    },
    {
      name: 'liasse_jobs',
      help: 'Jobs by kind and status.',
      type: 'gauge',
      samples: jobs.map(({ count, ...labels }) => ({ labels, value: count })),
    },
    gauge('liasse_job_queue_depth', 'Queued jobs that are due.', queue.queueDepth),
    gauge(
      'liasse_job_queue_oldest_age_seconds',
      'How long the oldest due job has waited.',
      queue.oldestQueuedAgeSeconds,
    ),
  ];
  return `${families.map(renderFamily).join('\n')}\n`;
};
