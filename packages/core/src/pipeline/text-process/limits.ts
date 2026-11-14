const MEBIBYTE = 1024 * 1024;

export interface TextProcessLimits {
  // Resident memory of the extraction process, sampled by its watchdog thread.
  readonly maxRssBytes: number;
  // CPU time of the extraction process, every thread included. Waiting for the vision
  // model or for poppler costs it none, so only the reading of the file is on this clock.
  readonly maxCpuMs: number;
  // `--max-old-space-size` of the extraction process: the part of the limit V8 enforces
  // by itself, with no sampling involved.
  readonly maxOldSpaceMb: number;
  // Wall-clock time the process may spend without a word to the server while no vision
  // call is pending: a process stuck without using the processor is on no other clock.
  readonly maxIdleMs: number;
}

// Measured on macOS arm64 with Node 24: a 2000-page native PDF (the page limit) peaks at
// 267 MB and 1.7 s of CPU, a DOCX at its text limit at 235 MB and 0.3 s, while a 300 kB
// PDF inflating to 300 MB reaches 819 MB and 9 s. The memory limit sits about three times
// above the legitimate peak, and the CPU limit leaves room for a machine many times slower.
// A page sent to the vision model is first rendered, within 30 s (`renderTimeoutMs`):
// five minutes of silence is ten times what a slow render may take.
export const DEFAULT_TEXT_PROCESS_LIMITS: TextProcessLimits = Object.freeze({
  maxRssBytes: 768 * MEBIBYTE,
  maxCpuMs: 120_000,
  maxOldSpaceMb: 512,
  maxIdleMs: 300_000,
});

export const TEXT_PROCESS_ERROR_CODES = [
  'text_memory_limit',
  'text_cpu_limit',
  'text_process_crashed',
  'text_process_timeout',
] as const;
export type TextProcessErrorCode = (typeof TEXT_PROCESS_ERROR_CODES)[number];

// The same bytes exceed the same limit at every attempt. A process that ended for another
// reason, or went silent, may have been a victim of the machine.
const RETRYABLE: Readonly<Record<TextProcessErrorCode, boolean>> = {
  text_memory_limit: false,
  text_cpu_limit: false,
  text_process_crashed: true,
  text_process_timeout: true,
};

const MESSAGES: Readonly<Record<TextProcessErrorCode, string>> = {
  text_memory_limit: 'Reading the document needed more memory than the limit allows',
  text_cpu_limit: 'Reading the document needed more processor time than the limit allows',
  text_process_crashed: 'The process reading the document ended before it answered',
  text_process_timeout: 'The process reading the document stopped answering and was ended',
};

export class TextProcessError extends Error {
  override readonly name = 'TextProcessError';
  readonly code: TextProcessErrorCode;
  readonly retryable: boolean;

  constructor(code: TextProcessErrorCode) {
    super(MESSAGES[code]);
    this.code = code;
    this.retryable = RETRYABLE[code];
  }
}
