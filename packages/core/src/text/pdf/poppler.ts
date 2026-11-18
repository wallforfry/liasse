import { spawn } from 'node:child_process';
import { isAbortError, TextExtractionError } from '../errors.ts';

// What is kept of stderr, whatever the file makes the command print: its end, where the
// reason of a failure is.
const STDERR_TAIL_BYTES = 16 * 1024;
const MAX_REPORTED_STDERR = 300;
// poppler refuses a page whose box gives it no usable resolution; it does so every time.
const INVALID_GEOMETRY = 'hDPI or vDPI values are invalid';
const UNAVAILABLE_REASONS: Readonly<Record<string, string>> = {
  ENOENT: 'was not found; install poppler-utils to read scanned PDFs',
  EACCES: 'is not executable by this user; check its permissions',
};

export interface PopplerRunOptions {
  readonly timeoutMs: number;
  readonly signal: AbortSignal | undefined;
}

interface OutputTail {
  readonly push: (chunk: Buffer) => void;
  readonly text: () => string;
}

const createOutputTail = (): OutputTail => {
  let tail = Buffer.alloc(0);
  let truncated = false;
  return {
    push: (chunk) => {
      const joined = Buffer.concat([tail, chunk]);
      truncated ||= joined.length > STDERR_TAIL_BYTES;
      tail = joined.subarray(Math.max(0, joined.length - STDERR_TAIL_BYTES));
    },
    // The first line of a truncated tail is the end of a longer one: it is dropped, so
    // that the middle of a line is never read as its beginning.
    text: () => {
      const text = tail.toString('utf8');
      return truncated ? text.slice(text.indexOf('\n') + 1) : text;
    },
  };
};

const failed = (command: string, stderr: string): TextExtractionError => {
  const reported = stderr.trim();
  return new TextExtractionError(
    reported.includes(INVALID_GEOMETRY) ? 'pdf_page_unrenderable' : 'pdf_renderer_failed',
    `The command ${command} failed on a PDF page${reported === '' ? '' : `: ${reported.slice(-MAX_REPORTED_STDERR)}`}`,
  );
};

// A command that is absent or that this user may not execute stays so on every attempt:
// both need the operator.
const toSpawnError = (error: Error, command: string): Error => {
  if (isAbortError(error)) return error;
  const reason =
    'code' in error && typeof error.code === 'string' ? UNAVAILABLE_REASONS[error.code] : undefined;
  return reason === undefined
    ? new TextExtractionError('pdf_renderer_failed', `The command ${command} could not run`, {
        cause: error,
      })
    : new TextExtractionError('pdf_renderer_missing', `The command ${command} ${reason}`, {
        cause: error,
      });
};

const ignore = (): void => undefined;

// `deadline` aborts once the command has run for `timeoutMs`, the duration the timeout
// error names.
export interface PopplerDeadlineOptions extends PopplerRunOptions {
  readonly deadline: AbortSignal;
}

// Runs one poppler command without a shell, and kills it when `deadline` aborts. What it
// writes on stdout is handed to `onStdout` chunk by chunk and not kept. A child killed
// from outside, by the memory limit of a container for instance, is a failure that
// another attempt may not meet; only one killed at the deadline is a timeout.
export const runPopplerUntil = (
  command: string,
  args: readonly string[],
  { deadline, timeoutMs, signal }: PopplerDeadlineOptions,
  onStdout: (chunk: Uint8Array) => void = ignore,
): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      killSignal: 'SIGKILL',
      ...(signal === undefined ? {} : { signal }),
    });
    const stderr = createOutputTail();
    let expired = false;
    const expire = (): void => {
      expired = true;
      child.kill('SIGKILL');
    };
    const disarm = (): void => {
      deadline.removeEventListener('abort', expire);
    };
    // A process the command started may outlive it and keep the pipes open: letting go of
    // them is what ends the wait on this side, and what stops that process at its next
    // write.
    const releasePipes = (): void => {
      child.stdout.destroy();
      child.stderr.destroy();
    };
    child.stdout.on('data', onStdout);
    child.stderr.on('data', stderr.push);
    child.on('error', (error) => {
      disarm();
      releasePipes();
      reject(toSpawnError(error, command));
    });
    // `close` waits for the pipes, which a surviving grandchild holds for as long as it
    // lives: a timeout is reported when the killed child exits, not then.
    child.on('exit', (code) => {
      disarm();
      if (code !== null || !expired) return;
      releasePipes();
      reject(
        new TextExtractionError(
          'pdf_renderer_timeout',
          `The command ${command} took longer than ${String(timeoutMs)} ms on a PDF page`,
        ),
      );
    });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(failed(command, stderr.text()));
    });
    if (deadline.aborted) expire();
    else deadline.addEventListener('abort', expire, { once: true });
  });

// The deadline is a signal rather than the `timeout` option of `spawn`, whose timer starts
// at spawn time out of any caller's reach: a test fires it once the command is ready.
export const runPoppler = (
  command: string,
  args: readonly string[],
  options: PopplerRunOptions,
  onStdout: (chunk: Uint8Array) => void = ignore,
): Promise<void> =>
  runPopplerUntil(
    command,
    args,
    { ...options, deadline: AbortSignal.timeout(options.timeoutMs) },
    onStdout,
  );
