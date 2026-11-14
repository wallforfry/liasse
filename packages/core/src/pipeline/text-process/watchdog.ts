import { writeSync } from 'node:fs';
import { parentPort } from 'node:worker_threads';
import { VERDICT_FD, WATCHING, type WatchdogVerdict } from './verdict.ts';

// Entry point of a worker thread inside the extraction process. pdfjs can hold the main
// thread of that process for minutes, and much of what it allocates is outside the V8
// heap: this thread keeps its own event loop, measures the whole process and ends it.
// It imports nothing heavy, so it is watching before the first document byte is read.

const SAMPLE_INTERVAL_MS = 20;

const [maxRssBytes, maxCpuMs] = process.argv.slice(2).map(Number);
if (maxRssBytes === undefined || maxCpuMs === undefined || !(maxRssBytes > 0 && maxCpuMs > 0)) {
  throw new Error('usage: watchdog <max rss in bytes> <max cpu in milliseconds>');
}

const verdict = (): WatchdogVerdict | undefined => {
  if (process.memoryUsage.rss() > maxRssBytes) return 'memory';
  const { user, system } = process.cpuUsage();
  return (user + system) / 1000 > maxCpuMs ? 'cpu' : undefined;
};

const enforce = (): void => {
  const reason = verdict();
  if (reason === undefined) return;
  try {
    writeSync(VERDICT_FD, reason);
  } catch {
    // The parent is gone: the process still has to end.
  }
  // `process.exit` in a worker only ends the worker, and no handler can run on a main
  // thread that is busy: the signal is the one that needs neither.
  process.kill(process.pid, 'SIGKILL');
};

enforce();
setInterval(enforce, SAMPLE_INTERVAL_MS);
parentPort?.postMessage(WATCHING);
