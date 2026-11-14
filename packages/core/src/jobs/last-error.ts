export const MAX_LAST_ERROR_LENGTH = 500;

const REDACTED = '[redacted]';

// Best effort: the shapes a secret takes in the error messages of HTTP and database
// clients. A handler must still keep secrets out of the errors it throws itself.
const SECRET_PATTERNS: readonly (readonly [RegExp, string])[] = [
  [/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, `$1${REDACTED}@`],
  [/\b(bearer|basic)\s+[\w.~+/=-]+/gi, `$1 ${REDACTED}`],
  [
    /\b((?:api[-_]?key|token|secret|password|authorization)["']?\s*[=:]\s*)["']?[^\s"',;&]+/gi,
    `$1${REDACTED}`,
  ],
];

const redact = (text: string): string =>
  SECRET_PATTERNS.reduce(
    (redacted, [pattern, replacement]) => redacted.replace(pattern, replacement),
    text,
  );

// The stack and the cause stay out: they are for the log, and `jobs.last_error` is
// shown to API and MCP clients.
export const describeJobError = (error: unknown): string => {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : 'Non-error thrown';
  return redact(text).slice(0, MAX_LAST_ERROR_LENGTH);
};
