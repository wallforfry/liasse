import { spawn } from 'node:child_process';
import { isAbortError, TextExtractionError } from '../errors.ts';

// What is kept of each output stream. The lines read from `pdfinfo` are its last ones,
// after document information of any length, so the end is enough and memory stays
// bounded whatever the file makes the command print.
const OUTPUT_TAIL_BYTES = 16 * 1024;
const MAX_REPORTED_STDERR = 300;
// poppler refuses a page whose box gives it no usable resolution; it does so every time.
const INVALID_GEOMETRY = 'hDPI or vDPI values are invalid';

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
      truncated ||= joined.length > OUTPUT_TAIL_BYTES;
      tail = joined.subarray(Math.max(0, joined.length - OUTPUT_TAIL_BYTES));
    },
    // The first line of a truncated tail is the end of a longer one: it is dropped, so
    // that the middle of a line is never read as its beginning.
    text: () => {
      const text = tail.toString('utf8');
      return truncated ? text.slice(text.indexOf('\n') + 1) : text;
    },
  };
};

const missing = (command: string, cause: unknown): TextExtractionError =>
  new TextExtractionError(
    'pdf_renderer_missing',
    `The command ${command} was not found; install poppler-utils to read scanned PDFs`,
    { cause },
  );

const failed = (command: string, stderr: string): TextExtractionError => {
  const reported = stderr.trim();
  return new TextExtractionError(
    reported.includes(INVALID_GEOMETRY) ? 'pdf_page_unrenderable' : 'pdf_renderer_failed',
    `The command ${command} failed on a PDF page${reported === '' ? '' : `: ${reported.slice(-MAX_REPORTED_STDERR)}`}`,
  );
};

const toSpawnError = (error: Error, command: string): Error => {
  if (isAbortError(error)) return error;
  const notFound = 'code' in error && error.code === 'ENOENT';
  return notFound
    ? missing(command, error)
    : new TextExtractionError('pdf_renderer_failed', `The command ${command} could not run`, {
        cause: error,
      });
};

// Runs one poppler command without a shell and returns the end of what it wrote on
// stdout. Node kills the child itself on a timeout (`killed` is then true); a child
// killed from outside, by the memory limit of a container for instance, is a failure
// that another attempt may not meet.
export const runPoppler = (
  command: string,
  args: readonly string[],
  { timeoutMs, signal }: PopplerRunOptions,
): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: timeoutMs,
      killSignal: 'SIGKILL',
      ...(signal === undefined ? {} : { signal }),
    });
    const stdout = createOutputTail();
    const stderr = createOutputTail();
    child.stdout.on('data', stdout.push);
    child.stderr.on('data', stderr.push);
    child.on('error', (error) => {
      reject(toSpawnError(error, command));
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.text());
      } else if (code === null && child.killed) {
        reject(
          new TextExtractionError(
            'pdf_renderer_timeout',
            `The command ${command} took longer than ${String(timeoutMs)} ms on a PDF page`,
          ),
        );
      } else {
        reject(failed(command, stderr.text()));
      }
    });
  });
