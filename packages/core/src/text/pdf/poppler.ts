import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isAbortError, TextExtractionError } from '../errors.ts';

const run = promisify(execFile);

const MAX_REPORTED_STDERR = 300;
// poppler refuses a page whose box gives it no usable resolution; it does so every time.
const INVALID_GEOMETRY = 'hDPI or vDPI values are invalid';

export interface PopplerRunOptions {
  readonly timeoutMs: number;
  readonly signal: AbortSignal | undefined;
}

const hasProperty = <K extends string>(value: unknown, key: K): value is Record<K, unknown> =>
  typeof value === 'object' && value !== null && key in value;

const toPopplerError = (error: unknown, command: string, timeoutMs: number): unknown => {
  if (isAbortError(error)) return error;
  if (hasProperty(error, 'code') && error.code === 'ENOENT') {
    return new TextExtractionError(
      'pdf_renderer_missing',
      `The command ${command} was not found; install poppler-utils to read scanned PDFs`,
      { cause: error },
    );
  }
  if (hasProperty(error, 'killed') && error.killed === true) {
    return new TextExtractionError(
      'pdf_renderer_timeout',
      `The command ${command} took longer than ${String(timeoutMs)} ms on a PDF page`,
      { cause: error },
    );
  }
  const stderr =
    hasProperty(error, 'stderr') && typeof error.stderr === 'string' ? error.stderr.trim() : '';
  return new TextExtractionError(
    stderr.includes(INVALID_GEOMETRY) ? 'pdf_page_unrenderable' : 'pdf_renderer_failed',
    `The command ${command} failed on a PDF page${stderr === '' ? '' : `: ${stderr.slice(0, MAX_REPORTED_STDERR)}`}`,
    { cause: error },
  );
};

// Runs one poppler command without a shell and returns what it wrote on stdout.
export const runPoppler = async (
  command: string,
  args: readonly string[],
  { timeoutMs, signal }: PopplerRunOptions,
): Promise<string> => {
  try {
    const { stdout } = await run(command, [...args], {
      timeout: timeoutMs,
      killSignal: 'SIGKILL',
      ...(signal === undefined ? {} : { signal }),
    });
    return stdout;
  } catch (error) {
    throw toPopplerError(error, command, timeoutMs);
  }
};
